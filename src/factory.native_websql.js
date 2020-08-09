(function($, window, undefined) {
    'use strict';

    var NativeWebSqlFactory = function(name, version, displayName, estimatedSize) {
        if (!(this instanceof NativeWebSqlFactory)) {
            return new NativeWebSqlFactory(name, version, displayName, estimatedSize);
        }

        _checkName(name);
        if ('' === ''+displayName) {
            displayName = name;
        }

        version = version && '' !== version ? '' + version : '0.0';
        estimatedSize = estimatedSize && estimatedSize > 1024 ? parseInt(estimatedSize, 10) : 5 * 1024 * 1024;

        Object.defineProperty(this, 'name',{value: name, writable: false, configurable: false});
        Object.defineProperty(this, 'version',{value: version, writable: false, configurable: false});
        Object.defineProperty(this, 'displayName',{value: displayName, writable: false, configurable: false});
        Object.defineProperty(this, 'estimatedSize',{value: estimatedSize, writable: false, configurable: false});

        Object.freeze(this);
    };

    /**
     * @return {Database}
     */
    NativeWebSqlFactory.prototype.openDatabase = function() {
        return window.openDatabase(this.name, this.version, this.displayName, this.estimatedSize);
    };

    function _checkName(name)
    {
        if (!name || typeof name !== 'string' || '' === name) {
            throw new TypeError('name has to be a non-empty string!');
        }
    }
    $.DbConnectionNativeWebSql = NativeWebSqlFactory;
})(af, window);
