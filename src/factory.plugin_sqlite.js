(function($, window, undefined) {
    'use strict';

    var PluginSqliteFactory = function(name, options) {
        if (!(this instanceof PluginSqliteFactory)) {
            return new PluginSqliteFactory(options);
        }

        _checkName(name);
        this.options = 'object' !== typeof options ? {} : options;
        this.options.name = name;

        Object.freeze(this);
    };

    /**
     * @return {Database}
     */
    PluginSqliteFactory.prototype.openDatabase = function() {
        //noinspection JSUnresolvedVariable
        return window.sqlitePlugin.openDatabase(this.options);
    };

    function _checkName(name)
    {
        if (!name || 'string' !== typeof name || '' === name) {
            throw new TypeError('name has to be a non-empty string!');
        }
    }

    /**
     * Factory for SqlitPlugin databases.
     *
     * @type {PluginSqliteFactory}
     * @alias af.DbConnectionFactoryPluginSqlite
     *
     * @see https://github.com/brodybits/cordova-sqlite-ext
     */
    $.DbConnectionFactoryPluginSqlite = PluginSqliteFactory;
})(af, window);
