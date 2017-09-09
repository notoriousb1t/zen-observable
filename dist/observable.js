this.just = this.just || {};
this.just.observe = (function (exports) {
'use strict';

function hasSymbol(name) {
    return typeof Symbol === "function" && Boolean(Symbol[name]);
}
function getSymbol(name) {
    return hasSymbol(name) ? Symbol[name] : "@@" + name;
}
if (typeof Symbol === "function" && !Symbol.observable) {
    Symbol.observable = Symbol("observable");
}
function getMethod(obj, key) {
    var value = obj[key];
    if (value == null)
        return undefined;
    if (typeof value !== "function")
        throw new TypeError(value + " is not a function");
    return value;
}
function getSpecies(obj) {
    var ctor = obj.constructor;
    if (ctor !== undefined) {
        ctor = ctor[getSymbol("species")];
        if (ctor === null) {
            ctor = undefined;
        }
    }
    return ctor !== undefined ? ctor : Observable;
}
function addMethods(target, methods) {
    Object.keys(methods).forEach(function (k) {
        var desc = Object.getOwnPropertyDescriptor(methods, k);
        desc.enumerable = false;
        Object.defineProperty(target, k, desc);
    });
}
function cleanupSubscription(subscription) {
    var cleanup = subscription._cleanup;
    if (!cleanup)
        return;
    subscription._cleanup = undefined;
    cleanup();
}
function subscriptionClosed(subscription) {
    return subscription._observer === undefined;
}
function closeSubscription(subscription) {
    if (subscriptionClosed(subscription))
        return;
    subscription._observer = undefined;
    cleanupSubscription(subscription);
}
function cleanupFromSubscription(subscription) {
    return function () { subscription.unsubscribe(); };
}
function Subscription(observer, subscriber) {
    if (Object(observer) !== observer)
        throw new TypeError("Observer must be an object");
    this._cleanup = undefined;
    this._observer = observer;
    var start = getMethod(observer, "start");
    if (start)
        start.call(observer, this);
    if (subscriptionClosed(this))
        return;
    observer = new SubscriptionObserver(this);
    try {
        var cleanup = subscriber.call(undefined, observer);
        if (cleanup != null) {
            if (typeof cleanup.unsubscribe === "function")
                cleanup = cleanupFromSubscription(cleanup);
            else if (typeof cleanup !== "function")
                throw new TypeError(cleanup + " is not a function");
            this._cleanup = cleanup;
        }
    }
    catch (e) {
        observer.error(e);
        return;
    }
    if (subscriptionClosed(this))
        cleanupSubscription(this);
}
addMethods(Subscription.prototype = {}, {
    get closed() { return subscriptionClosed(this); },
    unsubscribe: function () { closeSubscription(this); },
});
function SubscriptionObserver(subscription) {
    this._subscription = subscription;
}
addMethods(SubscriptionObserver.prototype = {}, {
    get closed() { return subscriptionClosed(this._subscription); },
    next: function (value) {
        var subscription = this._subscription;
        if (subscriptionClosed(subscription))
            return undefined;
        var observer = subscription._observer;
        var m = getMethod(observer, "next");
        if (!m)
            return undefined;
        return m.call(observer, value);
    },
    error: function (value) {
        var subscription = this._subscription;
        if (subscriptionClosed(subscription))
            throw value;
        var observer = subscription._observer;
        subscription._observer = undefined;
        try {
            var m = getMethod(observer, "error");
            if (!m)
                throw value;
            value = m.call(observer, value);
        }
        catch (e) {
            try {
                cleanupSubscription(subscription);
            }
            finally {
                throw e;
            }
        }
        cleanupSubscription(subscription);
        return value;
    },
    complete: function (value) {
        var subscription = this._subscription;
        if (subscriptionClosed(subscription))
            return undefined;
        var observer = subscription._observer;
        subscription._observer = undefined;
        try {
            var m = getMethod(observer, "complete");
            value = m ? m.call(observer, value) : undefined;
        }
        catch (e) {
            try {
                cleanupSubscription(subscription);
            }
            finally {
                throw e;
            }
        }
        cleanupSubscription(subscription);
        return value;
    },
});
function Observable(subscriber) {
    if (typeof subscriber !== "function")
        throw new TypeError("Observable initializer must be a function");
    this._subscriber = subscriber;
}
addMethods(Observable.prototype, {
    subscribe: function (observer) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (typeof observer === 'function') {
            observer = {
                next: observer,
                error: args[0],
                complete: args[1],
            };
        }
        return new Subscription(observer, this._subscriber);
    },
    forEach: function (fn) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (typeof fn !== "function")
                return Promise.reject(new TypeError(fn + " is not a function"));
            _this.subscribe({
                _subscription: null,
                start: function (subscription) {
                    if (Object(subscription) !== subscription)
                        throw new TypeError(subscription + " is not an object");
                    this._subscription = subscription;
                },
                next: function (value) {
                    var subscription = this._subscription;
                    if (subscription.closed)
                        return;
                    try {
                        return fn(value);
                    }
                    catch (err) {
                        reject(err);
                        subscription.unsubscribe();
                    }
                },
                error: reject,
                complete: resolve,
            });
        });
    },
    map: function (fn) {
        var _this = this;
        if (typeof fn !== "function")
            throw new TypeError(fn + " is not a function");
        var C = getSpecies(this);
        return new C(function (observer) { return _this.subscribe({
            next: function (value) {
                if (observer.closed)
                    return;
                try {
                    value = fn(value);
                }
                catch (e) {
                    return observer.error(e);
                }
                return observer.next(value);
            },
            error: function (e) { return observer.error(e); },
            complete: function (x) { return observer.complete(x); },
        }); });
    },
    filter: function (fn) {
        var _this = this;
        if (typeof fn !== "function")
            throw new TypeError(fn + " is not a function");
        var C = getSpecies(this);
        return new C(function (observer) { return _this.subscribe({
            next: function (value) {
                if (observer.closed)
                    return;
                try {
                    if (!fn(value))
                        return undefined;
                }
                catch (e) {
                    return observer.error(e);
                }
                return observer.next(value);
            },
            error: function (e) { return observer.error(e); },
            complete: function () { return observer.complete(); },
        }); });
    },
    reduce: function (fn) {
        var _this = this;
        if (typeof fn !== "function")
            throw new TypeError(fn + " is not a function");
        var C = getSpecies(this);
        var hasSeed = arguments.length > 1;
        var hasValue = false;
        var seed = arguments[1];
        var acc = seed;
        return new C(function (observer) { return _this.subscribe({
            next: function (value) {
                if (observer.closed)
                    return;
                var first = !hasValue;
                hasValue = true;
                if (!first || hasSeed) {
                    try {
                        acc = fn(acc, value);
                    }
                    catch (e) {
                        return observer.error(e);
                    }
                }
                else {
                    acc = value;
                }
            },
            error: function (e) { observer.error(e); },
            complete: function () {
                if (!hasValue && !hasSeed) {
                    observer.error(new TypeError("Cannot reduce an empty sequence"));
                    return;
                }
                observer.next(acc);
                observer.complete();
            },
        }); });
    },
    flatMap: function (fn) {
        var _this = this;
        if (typeof fn !== "function")
            throw new TypeError(fn + " is not a function");
        var C = getSpecies(this);
        return new C(function (observer) {
            var completed = false;
            var subscriptions = [];
            var outer = _this.subscribe({
                next: function (value) {
                    if (fn) {
                        try {
                            value = fn(value);
                        }
                        catch (x) {
                            observer.error(x);
                            return;
                        }
                    }
                    Observable.from(value).subscribe({
                        _subscription: null,
                        start: function (s) { subscriptions.push(this._subscription = s); },
                        next: function (value) { observer.next(value); },
                        error: function (e) { observer.error(e); },
                        complete: function () {
                            var i = subscriptions.indexOf(this._subscription);
                            if (i >= 0)
                                subscriptions.splice(i, 1);
                            closeIfDone();
                        }
                    });
                },
                error: function (e) {
                    return observer.error(e);
                },
                complete: function () {
                    completed = true;
                    closeIfDone();
                }
            });
            function closeIfDone() {
                if (completed && subscriptions.length === 0)
                    observer.complete();
            }
            return function () {
                subscriptions.forEach(function (s) { return s.unsubscribe(); });
                outer.unsubscribe();
            };
        });
    },
});
Object.defineProperty(Observable.prototype, getSymbol("observable"), {
    value: function () { return this; },
    writable: true,
    configurable: true,
});
addMethods(Observable, {
    from: function (x) {
        var C = typeof this === "function" ? this : Observable;
        if (x == null)
            throw new TypeError(x + " is not an object");
        var method = getMethod(x, getSymbol("observable"));
        if (method) {
            var observable_1 = method.call(x);
            if (Object(observable_1) !== observable_1)
                throw new TypeError(observable_1 + " is not an object");
            if (observable_1.constructor === C)
                return observable_1;
            return new C(function (observer) { return observable_1.subscribe(observer); });
        }
        if (hasSymbol("iterator") && (method = getMethod(x, getSymbol("iterator")))) {
            return new C(function (observer) {
                for (var _i = 0, _a = method.call(x); _i < _a.length; _i++) {
                    var item = _a[_i];
                    observer.next(item);
                    if (observer.closed)
                        return;
                }
                observer.complete();
            });
        }
        if (Array.isArray(x)) {
            return new C(function (observer) {
                for (var i = 0; i < x.length; ++i) {
                    observer.next(x[i]);
                    if (observer.closed)
                        return;
                }
                observer.complete();
            });
        }
        throw new TypeError(x + " is not observable");
    },
    of: function () {
        var items = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            items[_i] = arguments[_i];
        }
        var C = typeof this === "function" ? this : Observable;
        return new C(function (observer) {
            for (var i = 0; i < items.length; ++i) {
                observer.next(items[i]);
                if (observer.closed)
                    return;
            }
            observer.complete();
        });
    },
});
Object.defineProperty(Observable, getSymbol("species"), {
    get: function () { return this; },
    configurable: true,
});

exports.Observable = Observable;

return exports;

}({}));
