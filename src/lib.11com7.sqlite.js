/**
 * db - Database-Connector/Helper for SQLite
 *
 * Copyright (c) 2012 11com7, Bornheim, Germany
 * Released under the MIT license
 * http://opensource.org/licenses/mit-license.php
 *
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-09-30
 */

/**
 * Events:
 * SQL:open               when the database is opened
 * SQL:close              when the database is closed
 * SQL:dropDatabase       when dropDatabase() starts to delete every data table
 * SQL:drop:<tablename>   when dropDatabase() starts to delete the table <tablename>
 */

(/**
 * @param {af} $
 * @param {Window} window
 * @param {undefined} [undefined]
 */
function($, window, undefined) {
    'use strict';

    // static »global« private const
    var
        // templates
        SQL_DT_DEFAULT = "STRFTIME('%s', 'NOW')",
        SQL_DT_CONSTRAINTS = 'NOT NULL DEFAULT (' + SQL_DT_DEFAULT + ')',
        SQL_CREATE_TABLE = 'CREATE TABLE IF NOT EXISTS <%=table%> (<%=fields%><%=constraints%>);',
        SQL_CREATE_INDEX = 'CREATE<%=unique%> INDEX IF NOT EXISTS <%=name%> ON <%=table%> (<%=fields%>);',
        SQL_CREATE_VIEW = 'CREATE VIEW IF NOT EXISTS <%=name%> AS <%=select%>;',
        SQL_DROP_TABLE = 'DROP TABLE IF EXISTS <%=table%>;',
        SQL_DROP_TRIGGER = 'DROP TRIGGER IF EXISTS <%=trigger%>;',
        SQL_DROP_INDEX = 'DROP INDEX IF EXISTS <%=index%>;',
        SQL_DROP_VIEW = 'DROP VIEW IF EXISTS <%=view%>;',
        SQL_CREATE_TRIGGER = 'CREATE TRIGGER IF NOT EXISTS <%=trigger%> <%=definition%>',
        SQL_DT_CHANGE_TRIGGER = ' AFTER UPDATE ON <%=table%> ' +
            'BEGIN ' +
            'UPDATE <%=table%> SET dt_change = ' + SQL_DT_DEFAULT + ' WHERE new.id = id; ' +
            'END;',

        // Timestamp templates
        timestampTpl = {
            INTEGER: "MAX(0, 1*STRFTIME('%s', ?))", // <-- preserve 0-value as 0 BUT only for dates since 1970-01-01
            TEXT: "STRFTIME('%Y-%m-%d %H:%M:%S', ?)", // <-- 'NOW' needs here an additional modifier ', LOCALTIME'
            NUMERIC: "STRFTIME('%J', ?)"
        },
        db2dateConverter = {
            INTEGER: function(seconds) {
                seconds = parseInt(seconds, 10);
                return 0 !== seconds ? new Date(seconds * 1000) : seconds;
            },
            // Safari needs some help (YYYY/MM/DD instead of YYYY-MM-DD)
            TEXT: function(dtstring) {
                return new Date(dtstring.replace(/-/g, '/'));
            },
            // Julian Date: unix epoch = 2440587.5 JD + sqlite assumes each day as '[...] exactly 86400 seconds [...]' (see http://www.sqlite.org/lang_datefunc.html)
            NUMERIC: function(juldate) {
                return new Date((juldate - 2440587.5) * 86400.0 * 1000);
            }
        }
    ;

    /**
     *
     * @param connectionFactory
     * @param options
     * @return {DatabaseAdapter}
     * @constructor
     * @namespace af.DatabaseAdapter
     */
    function DatabaseAdapter(connectionFactory, options)
    {
        _checkConnectionFactory(connectionFactory);

        if (!(this instanceof DatabaseAdapter)) {
            return new DatabaseAdapter(connectionFactory, options);
        }

        /**
         * @type {null|ConnectionFactory} factory with `openDatabase(): {Database}` method
         * @private
         */
        this.connectionFactory = connectionFactory;

        /**
         * @type {?Database} (Database) if the connection is opened | (null) if the connection is closed
         * @private
         */
        this.connection = null;

        /**
         * @type {*|DatabaseAdapter.prototype.defaultOptions} database options
         * @private
         */
        this.options = $.extend({}, DatabaseAdapter.prototype.defaultOptions);
        this.setOptions(options);

        /**
         * @type {string}
         * @private
         */
        this.sqlLast = '';

        /**
         * @type {boolean}
         * @private
         */
        this.initialized = false;

        /**
         * @type {{}} table defintions
         * @private
         */
        this.tables = {};

        /**
         * @type {{}} trigger defintions
         * @private
         */
        this.triggers = {};

        /**
         * @type {{}} index defintions
         * @private
         */
        this.indexes = {};

        /**
         * @type {{}} views defintions
         * @private
         */
        this.views = {};

        /**
         * @type {*[]} callbacks which are called after the database is open
         * @private
         */
        this.readyCallbacks = [];

        var self = this;
        [
            'connectionFactory', 'connection', 'options', 'sqlLast',
            'initialized', 'tables', 'triggers', 'indexes', 'views', 'readyCallbacks'
        ].forEach(function(key) {
            Object.defineProperty(self, key, {writable: true, enumerable: false, configurable: false});
        });

        if (!!this.options.autoExposeAsDb) {
            $.db = this;
        }
    }

    // --------------------------------------------------------------------------------
    // define DefaultOptions
    // --------------------------------------------------------------------------------
    DatabaseAdapter.prototype.defaultOptions = {
        autoInit: true,
        autoCollate: 'NOCASE',
        autoCollateTypes: /^(?:CHAR|VARCHAR|TEXT|CHARACTER)/i,
        autoDefault: true,
        autoExposeAsDb: false,
        dropOnInit: false,
        timestamp_create: 'dt_create',
        timestamp_change: 'dt_change',
        timestamp_type: 'INTEGER',
        debug: false
    };

    // --------------------------------------------------------------------------------
    // define CONSTANTS
    // --------------------------------------------------------------------------------
    /**
     * @namespace af.DatabaseAdapter
     */
    Object.defineProperties(
        DatabaseAdapter.prototype,
        {
            'SQLITE_TABLE_MASTER': {value: 'sqlite_master', writable: false, configurable: false},
            'SQLITE_TABLE_AUTOINCREMENT': {value: 'sqlite_sequence', writable: false, configurable: false},
            'SQLITE_TYPE_TABLE': {value: 'table', writable: false, configurable: false},
            'SQLITE_TYPE_VIEW': {value: 'view', writable: false, configurable: false},
            'SQLITE_TYPE_TRIGGER': {value: 'trigger', writable: false, configurable: false},
            'SQLITE_TYPE_INDEX': {value: 'index', writable: false, configurable: false}
        }
    );


    // ===================================================================================================================
    // DatabaseAdapter.Select
    // ===================================================================================================================
    /**
     * db.Select class definition.
     * @constructor
     * @namespace af.DatabaseAdapter.Select
     */
    DatabaseAdapter.prototype.Select = function() {
        this.select = '';
        this.from = '';
        this.where = '';
        this.group = '';
        this.having = '';
        this.order = '';
        this.limit = '';
    };

    /**
     * @namespace af.DatabaseAdapter.Select
     */
    DatabaseAdapter.prototype.Select.prototype = {
        constructor: DatabaseAdapter.prototype.Select,

        /**
         * Returns the value of an attribute.
         * @param {String} attribute
         * @returns {*}
         */
        get: function(attribute) {
            if (!attribute in this) {
                return undefined;
            }

            return this[attribute];
        },

        /**
         * Returns the string value of an attribute
         * @param {String} attribute
         * @param {String} [separator]
         * @returns {String}
         */
        getString: function(attribute, separator) {
            if (!attribute in this) {
                return undefined;
            }

            separator = separator || ' ';

            if (isArray(this[attribute])) {
                return this[attribute].join(separator);
            } else if (isObject(this[attribute]) && !!this[attribute].toString) {
                return this[attribute].toString();
            } else if (isFunction(this[attribute])) {
                return '' + this[attribute](this);
            } else {
                return '' + this[attribute];
            }
        }

    };


    // ===================================================================================================================
    // DatabaseAdapter.View
    // ===================================================================================================================
    /**
     * (internal) view class (only for jsdoc documentation).
     * @constructor
     * @namespace af.DatabaseAdapter.View
     */
    DatabaseAdapter.prototype.View = function() {
        /**
         * @type {Array.<Array>}
         */
        this.columns = [];

        /**
         * @type {Array}  ALWAYS EMPTY!
         */
        this.constraints = [];

        /**
         * @type {Object} { alias:entityName, ... }
         */
        this.tables = {};

        /**
         * @type {DatabaseAdapter.Select}
         */
        this.select = new DatabaseAdapter.Select();
    }


    // ===================================================================================================================
    // OPEN / CLOSE
    // ===================================================================================================================
    /**
     * Opens the database if necessary and returns the database connection.
     * @return {Database}
     */
    DatabaseAdapter.prototype.open = function() {
        if (!this.isOpen()) {
            try {
                this.dbg('open() --> open connnection');
                this.connection = this.connectionFactory.openDatabase();
                this._trigger('SQL:open');
            } catch (e) {
                throw new Error(
                    this.SqlError(
                        e,
                        '',
                        "openDatabase('" + this.connectionFactory.name + "')"
                    ));
            }
        }

        return this.connection;
    };

    /**
     * Change the connection factory (database).
     *
     * If the database connection was open, it will be closed and the new connection
     * will be opened immediately.
     *
     * @param {Object} connectionFactory database connection factory interface
     */
    DatabaseAdapter.prototype.reconnect = function(connectionFactory) {
        if (connectionFactory === this.connectionFactory) {
            return;
        }

        _checkConnectionFactory(connectionFactory);

        var isOpened = this.isOpen();
        if (isOpened) {
            this.dbg('reconnect() -> close previous connection');
            this.close();
        }

        this.connectionFactory = connectionFactory;

        if (isOpened) {
            this.dbg('reconnect() -> reopen new connection');
            this.open();
        }
    };

    /**
     * Close the database if opened.
     */
    DatabaseAdapter.prototype.close = function() {
        if (this.isOpen()) {
            this.dbg('close() --> close connection');

            this.connection.close();
            this.connection = null;
            this._trigger('SQL:close');
        }
    };

    /**
     * Return TRUE if database is already opened; otherwise FALSE.
     * @return {Boolean}
     */
    DatabaseAdapter.prototype.isOpen = function() {
        return !!this.connection;
    };

    /**
     * trigger an event on document and passes `this` and the connection ({?Database}).
     * @param {String} event Event name
     * @private
     */
    DatabaseAdapter.prototype._trigger = function(event) {
        //noinspection JSValidateTypes
        var $document = $(document);
        $document.trigger.apply($document, [event, {'instance': this, 'connection': this.connection}]);
    }


    // ===================================================================================================================
    // OPTIONS
    // ===================================================================================================================
    /**
     * Set options (object) or one option to value.
     * @param {Object|String} options  (Object) set existing option keys to tOption values;
     *                                  (String) existing option key for single option
     * @param {*} [value] for single option change
     */
    DatabaseAdapter.prototype.setOptions = function(options, value) {
        if ('string' === typeof options) {
            if (this.options.hasOwnProperty(options)) {
                var key = options;
                options = {};
                options[key] = value;
            } else {
                throw new Error("unknown option '" + options + "'");
            }
        }

        for (var key in options) {
            if (this.options.hasOwnProperty(key)) {
                this.options[key] = options[key];
            }
        }
    };

    /**
     * Returns one or all db.options (or undefined for non existing key).
     * @param {String} [key] nothing for all options or existing key for option[key]
     * @returns {Object|*|undefined} Object: all Options w/o key argument;
     *                               *: with existing key (option[key]);
     *                               undefined: for non existing keys
     */
    DatabaseAdapter.prototype.getOptions = function(key) {
        if (key === undefined) {
            return $.extend({}, this.options);
        }

        return this.options.hasOwnProperty(key) ? this.options[key] : undefined;
    };


    // ===================================================================================================================
    // db.ready()
    // ===================================================================================================================
    /**
     * Fügt Callback-Funktion hinzu, die entweder nach dem Öffnen der Datenbank ausgeführt werden ODER direkt, falls die Datenbank schon geöffnet ist.
     *
     * @param {function(Database)} callback
     */
    DatabaseAdapter.prototype.ready = function(callback) {
        if (!isFunction(callback)) {
            return;
        }

        var self = this;
        this.readyCallbacks.push(callback);

        if (this.isOpen()) {
            callback(this.connection);
        } else {
            $(document).bind('SQL:open', _doDbOpen);
        }

        function _doDbOpen(event)
        {
            $(document).unbind('SQL:open', _doDbOpen);
            $(document).bind('SQL:close', _doDbClose);

            if (!!event.data.instance && self === event.data.instance) {
                self.dbg('ready() --> call ' + self.readyCallbacks.length + ' ready callback(s).');
                self.readyCallbacks.forEach(function(callback) {
                    callback(self.connection);
                });
            }
        }

        function _doDbClose()
        {
            $(document).unbind('SQL:close', _doDbClose);
            $(document).bind('SQL:open', _doDbOpen);
        }
    };


    // ===================================================================================================================
    // TABLE
    // ===================================================================================================================
    /**
     * Adds (or overwrites) a table representation.
     * @param {String} tableName
     * @param {Array} columns with [ ['fieldName', 'type', 'column-constraints'] ]
     * @param {Array} [tableConstraints]
     */
    DatabaseAdapter.prototype.addTable = function(tableName, columns, tableConstraints) {
        if (!tableName) {
            throw new Error('missing or empty tableName');
        }

        columns = columns || {};
        tableConstraints = tableConstraints || [];

        this.tables[tableName] = {'columns': [], 'constraints': []};
        this.setColumns(tableName, columns);
        this.setTableConstraints(tableName, tableConstraints);

        this._prepareAutoTableDefinitions(tableName);
    };

    /**
     * Adds (or overwrite) a trigger.
     * @param triggerName
     * @param trigger
     */
    DatabaseAdapter.prototype.addTrigger = function(triggerName, trigger) {
        if (!triggerName) {
            throw new Error('missing or empty triggerName');
        }
        if (!trigger) {
            throw new Error('missing or empty trigger');
        }

        this.triggers[triggerName] = trigger;
    };


    /**
     * Adds (or overwrites) the column definitions for a table/column(s) combination.
     * Existing columns will be overwritten!
     * @param {String} tableName
     * @param {String|Array} columns (String) single column definition (needs definitions!);
     *                               (Array) multi column definitions [ ['fieldName', 'type', 'column-constraints'] ];
     *                               (Array) single column definition ['fieldName', 'type', 'column-constraints']
     * @param {Array} [definitions] only for single columns! Array(2) for column definition (['type', 'column-constraints'])
     */
    DatabaseAdapter.prototype.setColumns = function(tableName, columns, definitions) {
        if (!tableName) {
            throw new Error('missing or empty tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }

        if ('string' === typeof columns) {
            if (!definitions || !definitions.length || 2 !== definitions.length) {
                throw new Error("Missing or invalid definitions for '" + tableName + "'.'" + columns + "'");
            }

            columns = [[columns, definitions[0], definitions[1]]];
        }
        // pack single column array in outer array
        else if (isArray(columns) && 3 === columns.length && !isArray(columns[0])) {
            columns = [columns];
        }

        // columns: [0...n-1]['fieldName', 'type', 'column-constraints']
        var pos;
        for (var t = 0; t < columns.length; t++) {
            if (columns[t][1]) {
                columns[t][1] = columns[t][1].toUpperCase();
            } // TYPE to uppercase

            // replace column
            if ((pos = this._getColumnIndex(tableName, columns[t][0])) !== -1) {
                this.tables[tableName].columns[pos] = columns[t];
            }
            // add column
            else {
                this.tables[tableName].columns.push(columns[t]);
            }
        }
    };


    /**
     * Set (overwrites) all! table constraints for an existing table.
     *
     * INDEX command:
     * Allows to create an index for a table. Just add a constraint:
     * <code>
     *   ['INDEX', indexName, column(s)]
     *   // column(s) are defined as
     *   // - Array: [columnName0, ..., columnNameN-1] OR
     *   // - String: 'columnName' OR 'columnName0, ..., columnNameN-1'
     * </code>
     * 'PRIMARY KEY' or 'UNIQUE' index(es) could be created as normal SQLite constraint.
     *
     * @param tableName
     * @param tableConstraints
     */
    DatabaseAdapter.prototype.setTableConstraints = function(tableName, tableConstraints) {
        var self = this;

        if (!tableName) {
            throw new Error('missing or empty tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }

        tableConstraints = tableConstraints || [];


        // dom, 2013-01-06: special support for INDEX constraints
        // SQLite doesn't has an INDEX table constraint to create a simple index within a table definition.
        // DatabaseAdapter allows it with the INDEX command.
        tableConstraints = tableConstraints.filter(function(element, index) {

            if (element.hasOwnProperty(0) && 'INDEX' === element[0].toUpperCase()) {
                if (3 > element.length) {
                    throw new Error("unsupported INDEX table constraint declaration in '" +
                                        tableName + '.tableContraints[' + index +
                                        "]; NEEDS 3 elements: ['INDEX', indexName, 'field[,fieldN]'|[fields]!"
                    );
                }
                self.addIndex(element[1], tableName, element[2]);

                // remove element
                return false;
            } else {
                // preserve element
                return true;
            }
        });

        this.tables[tableName].constraints = tableConstraints;
    };


    // ===================================================================================================================
    // INDEX
    // ===================================================================================================================
    /**
     * Adds (or overwrites) an index.
     * @param {String} indexName
     * @param {String} tableName
     * @param {Array|String} columns Array: [columnName0, ..., columnNameN-1]; String: 'columnName' OR 'columnName0, ..., columnNameN-1'
     * @param {Boolean} [unique] default: false; create a unique index on true
     */
    DatabaseAdapter.prototype.addIndex = function(indexName, tableName, columns, unique) {
        if ('string' === typeof columns) {
            // single column name
            if (columns.indexOf(',') === -1) {
                columns = [columns];
            }
            // multiple columns
            else {
                columns = columns.split(/\s*,\s*/).filter(function(el) {
                    return !!el;
                });
            }
        }

        this.checkColumns(tableName, columns);

        // add index
        this.indexes[indexName] =
            {
                table: tableName,
                columns: columns,
                unique: (!!unique) ? ' UNIQUE' : ''
            };
    };


    // ===================================================================================================================
    // VIEW
    // ===================================================================================================================
    /**
     * Adds (or overwrites) a view definition, from which a view will be generated.
     * @param {String} viewName
     * @param {Array} columns Array(name, null|type definition, view_alias [, view_column|SqlClause])
     * @param {Object} tables {table_alias : entity_name}
     * @param {Object} select {[select:...], from:..., [where:...], [group:...], [having:...], [order:...], [limit:...]}
     */
    DatabaseAdapter.prototype.addView = function(viewName, columns, tables, select) {
        if (!viewName) {
            throw new Error('missing or empty viewName');
        }
        if (!columns || !columns.length) {
            throw new Error('missing or empty column array');
        }
        if (!tables || !isObject(tables)) {
            throw new Error('missing tables object');
        }
        if (!select || !select.from) {
            throw new Error('missing or empty select object; needs minimal from definition');
        }

        this.views[viewName] =
            {
                'columns': [],
                'constraints': [], // <-- always empty!
                'tables': $.extend({}, tables),
                'select': $.extend(new this.Select(), select)
            };

        /** @type {db.View} */
        var viewObj = this.views[viewName];

        this.setViewColumns(viewName, columns);
    };


    /**
     * @param {String} viewName
     * @param {Array} columns Array(name, null|type definition, view_alias [, view_column|SqlClause])
     */
    DatabaseAdapter.prototype.setViewColumns = function(viewName, columns) {
        if (!viewName) {
            throw new TypeError('missing or empty viewName');
        }
        if (!this.isView(viewName)) {
            throw new TypeError("unknown viewName '" + viewName + "'");
        }
        if (!isArray(columns)) {
            throw new TypeError('columns has to be an array instead of (' + getType(columns) + ')');
        }


        if (isArray(columns) && columns.length > 2 && columns.length < 5 && !isArray(columns[0])) {
            columns = [columns];
        }

        // [ name, null|type definition, view_alias [, view_column|SqlClause] ]
        for (var t = 0; t < columns.length; t++) {
            var foreignEntity, colType,
                alias = columns[t][2],
                col = columns[t][0],
                foreignCol = (!!columns[t][3]) ? columns[t][3] : col;


            // FIND FOREIGN ENTITY
            if (!alias) {
                throw new TypeError("Missing/empty table alias for '" + viewName + '.' + col + "'");
            }

            // table alias?
            if (alias in this.views[viewName].tables) {
                foreignEntity = this._viewAlias2Entity(viewName, alias);
            } else {
                throw new TypeError("unknown entity alias '" + alias + "' for '" + viewName + '.' + col + "'");
            }

            // CHECK FOREIGN COLUMN
            if (!this.columnExists(foreignEntity, foreignCol)) {
                throw new TypeError("missing foreign column '" +
                                        foreignEntity + "'.'" + foreignCol +
                                        "' for " + viewName + '.' + col
                );
            }

            // FIND TYPE DEFINITIONS
            if (!columns[t][1]) {
                colType = this._getColumnData(foreignEntity, foreignCol, 'type');
            } else if (is('String', columns[t][1])) {
                colType = columns[t][1];
            } else {
                throw new TypeError("unknown column type definition '" + columns[t][1] + "' for " + viewName + '.' + col);
            }

            columns[t] = [col, colType, alias, foreignCol];
            var pos = this._getColumnIndex(viewName, col);
            // replace column
            if (pos !== -1) {
                this.views[viewName].columns[pos] = columns[t];
            }
            // add column
            else {
                this.views[viewName].columns.push(columns[t]);
            }
        }
    }


    /**
     * (internal) Returns an entity name (table or view) for an alias.
     * @param {String}viewName existing view
     * @param {String} alias existing entity alias
     * @returns {String}
     * @private
     */
    DatabaseAdapter.prototype._viewAlias2Entity = function(viewName, alias) {
        return this.views[viewName].tables[alias];
    }

    /**
     * @param {String}viewName existing view
     * @return {String} SELECT string for a view
     * @private
     */
    DatabaseAdapter.prototype._createViewSelect = function(viewName) {
        if (!viewName) {
            throw new TypeError('missing or empty viewName');
        }
        if (!this.isView(viewName)) {
            throw new TypeError("unknown viewName '" + viewName + "'");
        }

        var sql = 'SELECT ', t, tmp,
            /** DatabaseAdapter.prototype.View */
            view = this.views[viewName],
            columns = [],
            tables = [],
            select = [];

        // SELECT [ALL|DISTINCT]
        tmp = view.select.getString('select');
        sql += (tmp) ? tmp + ' ' : '';

        // COLUMNS
        for (t = 0; t < view.columns.length; t++) {
            var col = view.columns[t];
            columns.push(col[2] + '.' + col[3] + (col[0] !== col[3] ? ' AS ' + col[0] : ''));
        }
        sql += columns.join(', ') + ' ';

        // FROM
        tmp = view.select.getString('from');
        for (var alias in view.tables) {
            if (view.tables.hasOwnProperty(alias)) {
                tmp = tmp.replace('[' + alias + ']', view.tables[alias] + ' as ' + alias);
            }
        }
        sql += 'FROM ' + tmp + ' ';

        // WHERE
        tmp = view.select.getString('where');
        sql += tmp ? 'WHERE ' + tmp + ' ' : '';

        // GROUP BY
        tmp = view.select.getString('group');
        sql += tmp ? 'GROUP BY ' + tmp + ' ' : '';

        // HAVING
        tmp = view.select.getString('having');
        sql += tmp ? 'HAVING ' + tmp + ' ' : '';

        // ORDER BY
        tmp = view.select.getString('order');
        sql += tmp ? 'ORDER BY ' + tmp + ' ' : '';

        // LIMIT
        tmp = view.select.getString('limit');
        sql += tmp ? 'LIMIT ' + tmp + ' ' : '';

        return sql;
    }


    // ===================================================================================================================
    // GETTER / PUBLIC HELPER
    // ===================================================================================================================
    /**
     * Returns an array of all table names or the definitions (object) for one table, if tableName is an existing table; otherwise undefined.
     * @param {String} [tableName]
     * @return {Array|Object|undefined}
     */
    DatabaseAdapter.prototype.getTables = function(tableName) {
        return !tableName ? Object.keys(this.tables) : (this.tableExists(tableName) ? this.tables[tableName] : undefined);
    };

    /**
     * Returns an array of all table names or the definitions (object) for one table, if viewName is an existing table; otherwise undefined.
     * @param {String} [trigger]
     * @return {Array|Object|undefined}
     */
    DatabaseAdapter.prototype.getTriggers = function(trigger) {
        return !trigger ? Object.keys(this.triggers) : (this.triggers.hasOwnProperty(trigger) ? this.triggers[trigger] : undefined);
    };

    /**
     * Returns an array of all table names or the definitions (object) for one table, if viewName is an existing table; otherwise undefined.
     * @param {String} [index]
     * @return {Array|Object|undefined}
     */
    DatabaseAdapter.prototype.getIndexes = function(index) {
        return !index ? Object.keys(this.indexes) : (this.indexes.hasOwnProperty(index) ? this.indexes[index] : undefined);
    };

    /**
     * Returns an array of all table names or the definitions (object) for one table, if viewName is an existing table; otherwise undefined.
     * @param {String} [viewName]
     * @return {Array|Object|undefined}
     */
    DatabaseAdapter.prototype.getViews = function(viewName) {
        return !viewName ? Object.keys(this.views) : (this.views.hasOwnProperty(viewName) ? this.views[viewName] : undefined);
    };

    /**
     * Returns an array of all tables and views OR the definitions (object) for a table or view OR undefined if unknown.
     * @param {String} [entityName]
     * @returns {Array|Object|undefined}
     */
    DatabaseAdapter.prototype.getEntities = function(entityName) {
        if (!entityName) {
            return Object.keys(this.tables).concat(Object.keys(this.views));
        } else {
            if (this.isTable(entityName)) {
                return this.tables[entityName];
            } else if (this.isView(entityName)) {
                return this.views[entityName];
            }
        }

        return undefined;
    };

    /**
     * Returns all table definitions.
     * @return {Object} {tableName : tableDefinition, ...}
     */
    DatabaseAdapter.prototype.getAllTableDefinitions = function() {
        var definitions = {}, tables = this.getTables();

        for (var t = 0; t < tables.length; t++) {
            definitions[tables[t]] = this.getTables(tables[t]);
        }

        return definitions;
    };

    /**
     * Returns an array of all column names for an existing table OR the column definitions (Object) OR undefined for missing tables/columns.
     * @param {String} tableName
     * @param {String} [column]
     * @return {Array|Object|undefined}
     */
    DatabaseAdapter.prototype.getColumns = function(tableName, column) {
        if (!tableName) {
            throw new Error('missing tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }

        if (!column) {
            return this._getColumnNames(tableName);
        } else {
            var index = this._getColumnIndex(tableName, column);
            return (index > -1) ? this._getColumnData(tableName, index) : undefined;
        }
    };

    /**
     * Returns column type for an existing table.column definition.
     * @param {String} tableName
     * @param {String} column
     * @return {String}
     */
    DatabaseAdapter.prototype.getColumnType = function(tableName, column) {
        if (!tableName) {
            throw new Error('missing tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }
        if (!column) {
            throw new Error('missing column');
        }

        var index = this._getColumnIndex(tableName, column);
        if (index === -1) {
            throw new Error("column '" + tableName + "'.'" + column + "' isn't added/defined.");
        }

        return this._getColumnData(tableName, index, 'type');
    };

    /**
     * Returns TRUE if the tableName is a defined table; otherwise FALSE.
     * @param {String} tableName
     * @return {Boolean}
     * @see tableExists()
     */
    DatabaseAdapter.prototype.isTable = function(tableName) {
        return this.tableExists(tableName, true);
    };

    /**
     * Returns TRUE if the viewName is a defined view; otherwise FALSE.
     * @param {String} viewName
     * @return {Boolean}
     */
    DatabaseAdapter.prototype.isView = function(viewName) {
        return (viewName && this.views[viewName]);
    };

    /**
     * Returns TRUE if the indexName is a defined index; otherwise FALSE.
     * @param {String} indexName
     * @return {Boolean}
     */
    DatabaseAdapter.prototype.isIndex = function(indexName) {
        return (indexName && this.indexes[indexName]);
    };

    /**
     * Returns TRUE if the entityName (table OR view) is a defined view; otherwise FALSE.
     * @param {String} entityName
     * @return {Boolean}
     * @see tableExists()
     */
    DatabaseAdapter.prototype.isEntity = function(entityName) {
        return this.tableExists(tableName) || this.isView(entityName);
    };

    /**
     * Returns TRUE if the table (or view) exists; otherwise FALSE.
     * @param {String} tableName
     * @param {boolean} [strict] if TRUE it will only return true for tables; default: false
     * @return {Boolean}
     * @see isTable()
     */
    DatabaseAdapter.prototype.tableExists = function(tableName, strict) {
        return (tableName && (this.tables[tableName] || (!strict && this.views[tableName])));
    };

    /**
     * (Alias to isView()) Returns TRUE if the table is added/defined; otherwise FALSE.
     * @param {String} viewName
     * @return {Boolean}
     * @see isView()
     */
    DatabaseAdapter.prototype.viewExists = function(viewName) {
        return this.isView(viewName);
    };


    /**
     * Returns TRUE if the entity (table or view) is added/defined; otherwise FALSE.
     * @param {String} entityName
     * @return {Boolean}
     * @see tableExists()
     */
    DatabaseAdapter.prototype.entityExists = function(entityName) {
        return this.tableExists(entityName, false);
    };

    /**
     * Returns TRUE if the column (and table or view) is added/defined; otherwise FALSE.
     * @param {String} entityName
     * @param {String} column
     * @return {Boolean}
     */
    DatabaseAdapter.prototype.columnExists = function(entityName, column) {
        return entityName && column &&
            this.entityExists(entityName) && this._getColumnIndex(entityName, column) > -1;
    };


    /**
     * Checks an array with column names for a defined table (or view) and throws Error on non-defined columns.
     * @param {String} entityName
     * @param {Array} columns
     * @throws Error
     */
    DatabaseAdapter.prototype.checkColumns = function(entityName, columns) {
        if (!entityName) {
            throw new Error('missing tableName');
        }
        if (!this.entityExists(entityName)) {
            throw new Error("tableName '" + entityName + "' isn't added/defined.");
        }
        if (!columns || !isArray(columns)) {
            throw new Error("columns is '" + (typeof columns) + "' instead of an array");
        }

        var lastCol = null, self = this;
        if (!columns.every(function(col) {
            lastCol = col;
            return self.columnExists(entityName, col);
        })) {
            throw new Error("column '" + lastCol + "' doesn't exists in '" + entityName + "'");
        }
    };


    /**
     * Returns the database connection (if it isn't already opened, getDatabase will open the database).
     * @return {Database}
     * @deprecated use getConnection()
     */
    DatabaseAdapter.prototype.getDatabase = function() {
        return this.getConnection();
    };

    /**
     * Returns the database connection (if it isn't already opened, getDatabase will open the database).
     * @return {Database}
     */
    DatabaseAdapter.prototype.getConnection = function() {
        if (!this.isOpen()) {
            this.initDb();
        }

        return this.connection;
    };


    // ===================================================================================================================
    // init db
    // ===================================================================================================================
    /**
     * Initialize database – has to be called after configuration.
     * @param {SQLTransaction} [tx] used only for opened databases
     * @param {Boolean} [forceReInit] if this will be set to TRUE, initialized will be reset to false and the init process restarts
     * @param {function(SQLTransaction)} [readyCallback] will be called after initialisation is complete
     */
    DatabaseAdapter.prototype.initDb = function(tx, forceReInit, readyCallback) {
        var self = this;

        if (true === forceReInit) {
            if (this.options.debug) {
                this.dbg('initDb(...) --> force init');
            }
            this.initialized = false
        }

        if (this.initialized) {
            if (this.options.debug) {
                this.dbg('initDb(...) --> already initialized');
            }
            this._initReady(tx, readyCallback);
            return;
        }

        if (this.options.debug) {
            this.dbg('initDb(...) --> start init');
        }

        if (!this.isOpen()) {
            if (!!this.options.autoInit) {
                if (this.options.debug) {
                    this.dbg('initDb(...) --> autoInit active -> register this._initDb() callback');
                }

                //noinspection JSCheckFunctionSignatures,JSValidateTypes
                $(document).on('SQL:open', _openCallback);
            }

            if (this.options.debug) {
                this.dbg('initDb(...) --> open db');
            }
            this.open();
        } else {
            if (this.options.debug) {
                this.dbg('initDb(...) --> call this._initDb()');
            }
            this._initDb(tx, readyCallback);
        }

        function _openCallback(event)
        {
            if (!event.data || !event.data.instance || self !== event.data.instance) {
                return;
            }

            if (self.options.debug) {
                self.dbg('initDb(...) --> SQL:open -> unregister callback and call this._initDb()');
            }

            $(document).off('SQL:open', _openCallback);
            self._initDb(null, readyCallback);
        }
    };

    /**
     * @param tx
     * @param readyCallback
     * @private
     */
    DatabaseAdapter.prototype._initDb = function(tx, readyCallback) {
        if (this.options.debug) {
            this.dbg('this._initDb(...)');
        }

        if (!this.isOpen()) {
            throw new Error('database not opened');
        }

        var self = this,
            sql = '',
            tables = this.getTables();

        // autotransaction if needed
        if (this.autoTransaction(tx, function(tx) {
            self._initDb(tx, readyCallback);
        })) {
            return;
        }

        // ---------- tx exists -----------------------------------------
        // Tables
        sql = '::tables';
        for (var t = 0; t < tables.length; t++) {
            this.createTable(tx, tables[t]);
        }

        // Triggers
        sql = '::triggers';
        for (var trigger in this.triggers) {
            if (this.triggers.hasOwnProperty(trigger)) {
                this.createTrigger(tx, trigger);
            }
        }

        // Indexes
        sql = '::indexes';
        for (var index in this.indexes) {
            if (this.indexes.hasOwnProperty(index)) {
                this.createIndex(tx, index);
            }
        }

        // Views
        sql = '::views';
        for (var view in this.views) {
            if (this.views.hasOwnProperty(view)) {
                this.createView(tx, view);
            }
        }

        if (this.options.debug) {
            this.dbg('initDb(...) --> READY!');
        }

        this.initialized = true;
        this._initReady(tx, readyCallback);
    }

    DatabaseAdapter.prototype._initReady = function(tx, callback) {
        if (isFunction(callback)) {
            if (this.options.debug) {
                this.dbg('initDb(...) --> CALL READY CALLBACK!');
            }
            callback(tx);
        }
    }


    /**
     * Creates a table entity in the database.
     * @param {SQLTransaction} tx transaction object
     * @param {String} tableName table name
     * @param {Boolean} [force] (default: false); DROPS the table if true!
     */
    DatabaseAdapter.prototype.createTable = function(tx, tableName, force) {
        var sql;

        if (!!this.options.dropOnInit || !!force) {
            sql = $.template(SQL_DROP_TABLE, {'table': tableName});
            this.executeSql(tx, sql);
        }

        sql = this.getSqlTable(tableName);
        this.executeSql(tx, sql);
    };

    /**
     * Creates a named trigger in the database.
     * @param {SQLTransaction} tx transaction object
     * @param {String} trigger trigger name
     * @param {Boolean} [force] (default: false); DROPS the table if true!
     */
    DatabaseAdapter.prototype.createTrigger = function(tx, trigger, force) {
        var sql;

        if (!!this.options.dropOnInit || !!force) {
            sql = $.template(SQL_DROP_TRIGGER, {'trigger': trigger});
            this.executeSql(tx, sql);
        }

        sql = this.getSqlTrigger(trigger);
        this.executeSql(tx, sql);
    };

    /**
     * Creates a named index in the database.
     * @param {SQLTransaction} tx transaction object
     * @param {String} index index name
     * @param {Boolean} [force] (default: false); DROPS the table if true!
     */
    DatabaseAdapter.prototype.createIndex = function(tx, index, force) {
        var sql;

        if (!this.isIndex(index)) {
            throw new TypeError("unknown index: '" + index + "' (" + getType(index) + ')');
        }

        if (!!this.options.dropOnInit || !!force) {
            sql = $.template(SQL_DROP_INDEX, {'index': index});
            this.executeSql(tx, sql);
        }

        sql = this.getSqlIndex(index);
        this.executeSql(tx, sql);
    };

    /**
     * Creates a view in the database.
     * @param {SQLTransaction} tx transaction object
     * @param {String} view viewName
     * @param {Boolean} [force] if TRUE the view will be dropped an re-created; default: false
     */
    DatabaseAdapter.prototype.createView = function(tx, view, force) {
        var sql;

        if (!!this.options.dropOnInit || !!force) {
            sql = $.template(SQL_DROP_VIEW, {'view': view});
            this.executeSql(tx, sql);
        }

        sql = this.getSqlView(view);
        this.executeSql(tx, sql);
    };


    /**
     * Returns sql string with column definition statement.
     * @param {String} tableName table name
     * @return {String}
     * @private
     */
    DatabaseAdapter.prototype._getSqlTableColumns = function(tableName) {
        var sqlColumns = [], columns = this.getColumns(tableName), t;

        for (t = 0; t < columns.length; t++) {
            sqlColumns.push(this.getSqlColumn(tableName, columns[t]));
        }

        return sqlColumns.join(', ');
    }

    /**
     * Returns sql string with table constraints definitions.
     * @param {String} tableName table name
     * @return {String}
     * @private
     */
    DatabaseAdapter.prototype._getSqlTableConstraints = function(tableName) {
        return this.tables[tableName].constraints && this.tables[tableName].constraints.length > 0 ?
               ', ' + this.tables[tableName].constraints.join(', ') :
               '';
    }


    // ===================================================================================================================
    // DB SQL
    // ===================================================================================================================
    /**
     * Returns a SQL string for a (existing) table.
     * @param {String} tableName table name
     * @return {String}
     */
    DatabaseAdapter.prototype.getSqlTable = function(tableName) {
        return $.template(
            SQL_CREATE_TABLE,
            {
                'table': tableName,
                'fields': this._getSqlTableColumns(tableName),
                'constraints': this._getSqlTableConstraints(tableName)
            }
        );
    }


    /**
     * Returns a SQL string for a (existing) trigger.
     * @param {String} trigger
     * @return {String}
     */
    DatabaseAdapter.prototype.getSqlTrigger = function(trigger) {
        return $.template(SQL_CREATE_TRIGGER, {'trigger': trigger, 'definition': this.triggers[trigger]});
    }


    /**
     * Returns a SQL string for a (existing) index.
     * @param {String} index
     * @return {String}
     */
    DatabaseAdapter.prototype.getSqlIndex = function(index) {
        return $.template(
            SQL_CREATE_INDEX,
            {
                'name': index,
                'unique': this.indexes[index].unique,
                'table': this.indexes[index].table,
                'fields': this.indexes[index].columns.join(', ')
            }
        );
    }


    /**
     * Returns a SQL string for a (existing) view.
     * @param {String} view
     * @return {String}
     */
    DatabaseAdapter.prototype.getSqlView = function(view) {
        return $.template(SQL_CREATE_VIEW, {'name': view, 'select': this._createViewSelect(view)});
    }


    /**
     * Returns a SQL string for a (existing) table#column.
     * @param {String} tableName table name
     * @param {String} column column name
     * @return {String}
     */
    DatabaseAdapter.prototype.getSqlColumn = function(tableName, column) {
        var columnData = this._getColumnData(tableName, column).slice(0); // <-- CREATE COPY!

        // TYPE: convert to sql type (needed for auto date magic handling)
        columnData[1] = this.getSqlColumnType(tableName, column);

        // AUTO DEFAULT VALUE
        if (this.options.autoDefault
            && columnData[2].toUpperCase().indexOf('NOT NULL') > -1
            && columnData[2].toUpperCase().indexOf('DEFAULT') === -1) {
            var sqlDefault;

            if ('INTEGER' === columnData[1] || 'NUMERIC' === columnData[1] || 'REAL' === columnData[1]) {
                sqlDefault = '0';
            }
            // TEXT, BLOB, NONE
            else {
                sqlDefault = "''";
            }

            columnData[2] += ' DEFAULT ' + sqlDefault;
        }

        return columnData.join(' ');
    }


    /**
     * Returns a SQLite type (DATE/TIME types will be changed to the SQLite type affinity of options.timestamp_type).
     * @param {String} tableName !must exists!
     * @param {String} column !must exists!
     * @return {String} SQLite type
     */
    DatabaseAdapter.prototype.getSqlColumnType = function(tableName, column) {
        var colType = this.getColumnType(tableName, column);
        return this.getTypeAffinity(_isDateType(colType) ? this.options.timestamp_type : colType);
    };


    // ===================================================================================================================
    // SQL EXECUTE
    // ===================================================================================================================
    /**
     * Executes a sql statement with some auto enhancements (THIS FUNCTION SHOULD BE USED FOR ALL DATABASE EXECUTIONS!).
     * - auto transaction creation
     * - auto debugging
     * - auto store last sql statement (for errors)
     *
     * @param {SQLTransaction|null} tx transaction object OR undefined for auto transaction
     * @param {string} sql
     * @param {Object|Array} [data]
     * @param {function(SQLTransaction, SQLResultSet)} [successCallback]
     * @param {function(SQLTransaction, SQLError)} [errorCallback]
     */
    DatabaseAdapter.prototype.executeSql = function(tx, sql, data, successCallback, errorCallback) {
        var self = this;

        // no transaction
        if (!tx || !isObject(tx) || !tx.executeSql) {
            this.getConnection().transaction(function(tx) {
                self.executeSql(tx, sql, data, successCallback, errorCallback);
            });
            return;
        }

        // change arguments if data is successCallback
        if (isFunction(data) && 'undefined' === typeof errorCallback) {
            //noinspection JSValidateTypes
            errorCallback = successCallback;
            //noinspection JSValidateTypes
            successCallback = data;
            data = [];
        } else {
            data = !!data ? data : [];
        }

        successCallback = isFunction(successCallback) ? successCallback : undefined;
        errorCallback = isFunction(errorCallback) ? errorCallback : this._defaultQueryErrorCallback(sql);

        /** @type {SQLTransaction} tx */
        this.sqlLast = sql;
        if (this.options.debug) {
            this.dbg('', sql, data);
        }

        //noinspection JSValidateTypes
        tx.executeSql(sql, data, successCallback, errorCallback);
    };


    /**
     * Generates a sql query error callback function which could show the sql error with its REAL query string.
     * This method will be used as default error callback function for {@link db.executeSql()}.
     *
     * @param {string} sql sql string
     * @returns {function(SQLTransaction, SQLError)} error callback
     */
    DatabaseAdapter.prototype._defaultQueryErrorCallback = function(sql) {
        return function(tx, sqlError) {
            throw new Error(this.SqlError(sqlError, sql, '[DatabaseAdapter.defaultQueryErrorCallback()]'));
        }
    }


    // ===================================================================================================================
    // SQL SELECT HELPER
    // ===================================================================================================================
    /**
     * Executes a query and pass the results as Object[] to a successCallback.
     * @param {SQLTransaction|null} [tx] use existing SQLTransaction or (null) create a new transaction
     * @param {String|af.SqlClause} sql (String) SQL-Clause; ($.SqlClause) SqlClause-Object with sql AND data/values
     * @param {null|Array|function(Object[])} [data]  (null|Array) data: sql values or empty;
     *                                               (function()) successCallback (if no data is needed)
     * @param {function(Object[])|function(tx, SQLException)} [successCallback] (function(Object[])) successCallback (if data is not a function);
     *                                                                         (function(tx, SQLException)) errorCallback (if successCallback was passed in data)
     *
     * @param {function(tx, SQLException)} [errorCallback] errorCallback (will be called on SQLExceptions)
     */
    DatabaseAdapter.prototype.selectRows = function(tx, sql, data, successCallback, errorCallback) {
        if (isFunction(data)) {
            errorCallback = isFunction(successCallback) ? successCallback : errorCallback;
            successCallback = data;
            data = [];
        }

        //noinspection JSUnresolvedVariable
        if (sql instanceof $.SqlClause) {
            data = sql.values();
            sql = sql.get();
        }

        this.executeSql(tx, sql, data, _success, errorCallback);

        /**
         * @param {SQLTransaction} tx
         * @param {SQLResultSet} results
         * @private
         */
        function _success(tx, results)
        {
            var back = [];
            for (var t = 0; t < results.rows.length; t++) {
                back.push(results.rows.item(t));
            }

            if (isFunction(successCallback)) {
                successCallback(back);
            }
        }
    };

    /**
     * Executes a query and passes the first result row (object) or NULL (no result) to the successCallback.
     * @param {SQLTransaction|null} [tx] use existing SQLTransaction or (null) create a new transaction
     * @param {String|af.SqlClause} sql (String) SQL-Clause; ($.SqlClause) SqlClause-Object with sql AND data/values
     * @param {null|Array|function(Object|null)} [data]  (null|Array) data: sql values or empty;
     *                                               (function()) successCallback (if no data is needed)
     * @param {function(Object|null)|function(tx, SQLException)} [successCallback] (function(Object|null)) successCallback (if data is not a function);
     *                                                                         (function(tx, SQLException)) errorCallback (if successCallback was passed in data)
     *
     * @param {function(tx, SQLException)} [errorCallback] errorCallback (will be called on SQLExceptions)
     */
    DatabaseAdapter.prototype.selectFirstRow = function(tx, sql, data, successCallback, errorCallback) {
        if (isFunction(data)) {
            errorCallback = isFunction(successCallback) ? successCallback : errorCallback;
            successCallback = data;
            data = [];
        }

        sql = _addLimit(sql, 1);
        this.selectRows(tx, sql, data, _success, errorCallback);

        /**
         * @param {Object[]} results
         * @private
         */
        function _success(results)
        {
            if (isFunction(successCallback)) {
                successCallback(!!results && results.length ? results[0] : null);
            }
        }
    };

    /**
     * Executes a query and passes the first field of the first result row (*) or NULL (no result) to the successCallback.
     * @param {SQLTransaction|null} [tx] use existing SQLTransaction or (null) create a new transaction
     * @param {String|af.SqlClause} sql (String) SQL-Clause; ($.SqlClause) SqlClause-Object with sql AND data/values
     * @param {null|Array|function(*|null)} [data]  (null|Array) data: sql values or empty;
     *                                               (function()) successCallback (if no data is needed)
     * @param {function(*|null)|function(tx, SQLException)} [successCallback] (function(*|null)) successCallback (if data is not a function);
     *                                                                         (function(tx, SQLException)) errorCallback (if successCallback was passed in data)
     *
     * @param {function(tx, SQLException)} [errorCallback] errorCallback (will be called on SQLExceptions)
     */
    DatabaseAdapter.prototype.selectFirstField = function(tx, sql, data, successCallback, errorCallback) {
        if (isFunction(data)) {
            errorCallback = isFunction(successCallback) ? successCallback : errorCallback;
            successCallback = data;
            data = [];
        }

        this.selectFirstRow(tx, sql, data, _success, errorCallback);

        /**
         * @param {Object} results
         * @private
         */
        function _success(results)
        {
            if (isFunction(successCallback)) {
                successCallback(!!results ? results[[Object.keys(results)[0]]] : null);
            }
        }
    };

    /**
     * Executes a query and passes all first columns (*[]) or NULL (no result) to the successCallback.
     * @param {SQLTransaction|null} [tx] use existing SQLTransaction or (null) create a new transaction
     * @param {String|af.SqlClause} sql (String) SQL-Clause; ($.SqlClause) SqlClause-Object with sql AND data/values
     * @param {null|Array|function(*[]|null)} [data]  (null|Array) data: sql values or empty;
     *                                               (function()) successCallback (if no data is needed)
     * @param {function(*[]|null)|function(tx, SQLException)} [successCallback] (function(*[]|null)) successCallback (if data is not a function);
     *                                                                         (function(tx, SQLException)) errorCallback (if successCallback was passed in data)
     *
     * @param {function(tx, SQLException)} [errorCallback] errorCallback (will be called on SQLExceptions)
     */
    DatabaseAdapter.prototype.selectFirstColumn = function(tx, sql, data, successCallback, errorCallback) {
        if (isFunction(data)) {
            errorCallback = isFunction(successCallback) ? successCallback : errorCallback;
            successCallback = data;
            data = [];
        }

        this.selectRows(tx, sql, data, _success, errorCallback);

        /**
         * @param {Object[]} results
         * @private
         */
        function _success(results)
        {
            // get the first key of the first row object
            var columnKey = results.length ? Object.keys(results[0])[0] : '';

            if (isFunction(successCallback)) {
                successCallback(results.map(function(row) {
                    return row[columnKey];
                }));
            }
        }
    };


    /**
     * (internal) adds a limit (and offset) if the query hasn't already a limit.
     * @param {String|$.SqlClause} sql
     * @param {Number|String} limit
     * @param {Number|String} offset
     * @returns {String|$.SqlClause}
     * @private
     */
    function _addLimit(sql, limit, offset)
    {
        offset = 'undefined' !== typeof offset ? (', ' + offset) : '';

        var sqlType = getType(sql), limitClause = ' LIMIT ' + limit + offset;
        if ('String' === sqlType) {
            sql = _checkIfHasLimitClause(sql) ? sql : (sql + limitClause);
        } else { //noinspection JSUnresolvedVariable
            if ('Object' === sqlType && sql instanceof $.SqlClause) {
                if (!_checkIfHasLimitClause(sql)) {
                    sql.set(sql.get() + limitClause);
                }
            } else {
                throw new TypeError('sql has to be {String|$.SqlClause}, but was ' + sqlType);
            }
        }

        return sql;
    }

    /**
     * (internal) checks if a sql query has a limit.
     * @param {String} sql
     * @returns {boolean}
     * @private
     * @see http://www.sqlite.org/images/syntax/select-stmt.gif
     */
    function _checkIfHasLimitClause(sql)
    {
        var
            // selects a limit clause which isn't quoted via ["] or ['], the trick: only the wanted match is marked as group (in (...))
            // @see http://www.rexegg.com/regex-best-trick.html#thetrick
            regEx = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(\blimit(?:\s*(?:\d+|\?\d+|\?|[@$:][\w_]+)(?:\s*,\s*(?:[-]?\d+|\?\d+|\?|[@$:][\w_]+))?))/gi,
            results;

        // search ALL results until nothing could be found OR we've got a result for group 1 (in results[1]!)
        // ==> this ignores results[0] (overall match) and stops only if nothing was found or we've got a result for group 1
        while (null !== (results = regEx.exec('' + sql)) && !results[1]) {
        }

        return !!results && !!results[1];
    }


    // ===================================================================================================================
    // DEBUG & EXCEPTIONS
    // ===================================================================================================================
    /**
     * debugs any values to console.log (if exists && this.options.debug)
     * @param {...*} arguments
     */
    DatabaseAdapter.prototype.dbg = function() {
        if (this.options.debug && console && console.log) {
            var name = "DB['" + (this.connectionFactory.name || '') + "']:", args = Array.prototype.slice.call(arguments);
            args.unshift(name);
            console.log.apply(console, args);
        }
    };


    /**
     * Shows the result(s) of a query via console#log().
     * @param {String|af.SqlClause} sql (String) SQL-Clause; ($.SqlClause) SqlClause-Object with sql AND data/values
     * @param {null|Array} [data]  (null|Array) data: sql values or empty;
     */
    DatabaseAdapter.prototype.showRows = function(sql, data) {
        var self = this;

        this.selectRows(null, sql, data,
                        // SuccessCallback
                        function(results) {
                            if (isFunction(console.group)) {
                                console.group();
                            }
                            console.log('DatabaseAdapter.showRows():');
                            console.log(self.sqlLast, data);

                            //noinspection JSUnresolvedVariable
                            var tableFunc = !!console.table && isFunction(console.table) ? console.table : console.log;
                            tableFunc.call(console, results);

                            if (isFunction(console.groupEnd)) {
                                console.groupEnd();
                            }
                        },
                        // ErrorCallback
                        function(tx, error) {
                            console.log(self.SqlError(error, null));
                        }
        );
    };


    /**
     * (Factory) Creates a new Error/Exception object for a sql error.
     * This function will show the last sql statement, if db.executeSql() is used
     * @see executeSql()
     * @param {SQLError|SQLException|Error} errorObject
     * @param {String} [sql]
     * @param {String} [comment]
     * @return {String}
     */
    DatabaseAdapter.prototype.SqlError = function(errorObject, sql, comment) {
        // if there is no code entry this will be a »normal« exception
        if (!!errorObject && !errorObject.code && errorObject.message) {
            return errorObject.message;
        }

        sql = sql || 'sqlLast: »' + this.sqlLast + '«';
        comment = comment || '';

        var
            code = (!!errorObject && !!errorObject.code) ? errorObject.code : -424242,
            msg = (!!errorObject && !!errorObject.message) ? errorObject.message : '?unknown?';

        return 'SQL ERROR #' + code + ': ' + msg + " in '" + sql + "' --- " + comment;
    };


    // ===================================================================================================================
    // INSERT MULTI ROWS
    // ===================================================================================================================
    /**
     * Creates a multi row INSERT sql statement and inserts it in the database.
     * @param {String} tableName
     * @param {Array} columns
     * @param {Array} rows has to be an array with data arrays [[colData1, ..., colDataN], [...]]
     * @param {SQLTransaction} [tx] the functions creates a SQLTransaction if necessary
     * @param {function(SQLTransaction, SQLResultSet)} [readyCallback]
     * @param {function(SQLTransaction, SQLError)} [errorCallback]
     * @param {Object} [options] 'onConflict':[ROLLBACK|ABORT|FAIL|IGNORE|REPLACE]
     */
    DatabaseAdapter.prototype.insertMultiRows = function(tableName, columns, rows, tx, readyCallback, errorCallback, options) {
        var self = this;

        // start transaction if necessary
        if (!tx || 'object' !== typeof tx || !tx.executeSql) {
            this.getConnection().transaction(function(tx) {
                self.insertMultiRows(tableName, columns, rows, tx, readyCallback, errorCallback, options);
            });
            return;
        }

        if (!tableName) {
            throw new Error('missing or empty tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }

        this.checkColumns(tableName, columns);

        readyCallback = isFunction(readyCallback) ? readyCallback : undefined;
        errorCallback = isFunction(errorCallback) ? errorCallback : undefined;

        // fix for SQLITE ERROR #5: too many SQL variables (see http://www.sqlite.org/limits.html#max_variable_number)
        // fixed max 500 UNION statements per compound statement (see http://www.sqlite.org/limits.html#max_compound_select)
        var startRow = 0, rowsPerInsert = Math.min(Math.round(900 / columns.length), 499);
        _insertRowChunks();

        function _insertRowChunks()
        {
            var end = startRow + rowsPerInsert,
                chunkRows = rows.slice(startRow, end),
                sql = self.createSqlInsertMultiRows(tableName, columns, chunkRows, options),
                sqlValues = [];

            startRow += rowsPerInsert;

            for (var t = 0; t < chunkRows.length; t++) {
                var colsData = self.prepareData(chunkRows[t]);
                for (var tt = 0; tt < colsData.length; tt++) {
                    sqlValues.push(colsData[tt]);
                }
            }

            // dom, 2016-10-16, Bugfix: hier kam es zu einem 0-Insert-Bug, falls end exakt gleich der Gesamtanzahl war
            self.executeSql(tx, sql, sqlValues, (end >= rows.length) ? readyCallback : _insertRowChunks, errorCallback);
        }
    };

    /**
     * Generates a SQL-String for multi inserts based on INSERT INTO … + n-1 * UNION ALL SELECT ….
     * @param {String} tableName
     * @param {Array} columns
     * @param {Array} rows has to be an array with data arrays [[colData1, ..., colDataN], [...]]
     * @param {Object} [options] 'onConflict':[ROLLBACK|ABORT|FAIL|IGNORE|REPLACE]
     * @return {String}
     */
    DatabaseAdapter.prototype.createSqlInsertMultiRows = function(tableName, columns, rows, options) {
        if (!rows || !rows.length || 1 > rows.length) {
            return '';
        }
        if (999 < columns.length * rows.length) {
            throw new Error('maximum number of place-holder variables (' + (columns.length * rows.length) + ') will be greater then 999');
        }

        options = options || {};

        var
            onConflict = options.hasOwnProperty('onConflict') && options.onConflict ?
                         ' OR ' + options.onConflict.trim().toUpperCase() :
                         '',
            sql = 'INSERT' + onConflict + ' INTO ' + tableName + '(' + columns.join(',') + ') ';


        // first row as select
        var asTmp = [], placeholders = [], placeholder;
        for (var t = 0; t < columns.length; t++) {
            placeholder = this.getColumnPlaceholder(tableName, columns[t]);
            asTmp.push(placeholder + ' as ' + columns[t]);
            placeholders.push(placeholder);
        }

        sql += ' SELECT ' + asTmp.join(',');

        // then add the next rows as UNION ALL SELECT
        asTmp = [];
        placeholder = placeholders.join(', ');
        for (t = 1; t < rows.length; t++) {
            asTmp.push('UNION ALL SELECT ' + placeholder);
        }

        sql += ' ' + asTmp.join(' ');

        return sql;
    };


    // ===================================================================================================================
    // DROP DATABASE (polyfill)
    // ===================================================================================================================
    /**
     * This function will delete every deletable table, view, index, trigger and resets the sqlite_sequence table.
     * As there isn't a way to drop the database with JavaScript, this function is just a polyfill.
     *
     * @param {SQLTransaction} [tx] the functions creates a SQLTransaction if necessary
     */
    DatabaseAdapter.prototype.dropDatabase = function(tx, readyCallback) {
        var self = this;

        if (this.autoTransaction(tx, function(tx) {
            self.dropDatabase(tx, readyCallback)
        })) {
            return;
        }


        /** @type {SQLTransaction} tx */
        this.executeSql(tx, 'SELECT type,name FROM sqlite_master', [],
                        // SUCCESS
                        function(tx, results) {
                            self._trigger('SQL:dropDatabase');

                            // ignore this entities
                            var
                                ignoreNames =
                                    {
                                        '__WebKitDatabaseInfoTable__': true,
                                        'sqlite_autoindex___WebKitDatabaseInfoTable___1': true
                                    },
                                sqliteSequenceExists = false
                            ;

                            ignoreNames[self.SQLITE_TABLE_AUTOINCREMENT] = true;

                            // delete all table, trigger, indexes, views (ignore the entities above)
                            for (var t = 0; t < results.rows.length; t++) {
                                var name = results.rows.item(t).name;
                                if (!ignoreNames.hasOwnProperty(name)) {
                                    self._trigger('SQL:drop:' + name);
                                    self.executeSql(tx, 'DROP ' + results.rows.item(t).type + ' IF EXISTS ' + name, null);
                                } else if (name === self.SQLITE_TABLE_AUTOINCREMENT) {
                                    sqliteSequenceExists = true;
                                }
                            }

                            if (sqliteSequenceExists) {
                                self.executeSql(tx, 'DELETE FROM ' +
                                    self.SQLITE_TABLE_AUTOINCREMENT +
                                    ' WHERE name=name', [], readyCallback); // delete all auto ids
                            } else {
                                self.executeSql(tx, 'SELECT null', [], readyCallback);
                            }
                        },
                        // ERROR
                        _dbError
        );

        function _dbError(tx, error)
        {
            throw new Error(self.SqlError(error));
        }
    };


    // ===================================================================================================================
    // truncate (shim)
    // ===================================================================================================================
    /**
     * Empties a table completely and resets it's autoincrement counter if exists.
     *
     * @param {String} tableName Table OR ViewName
     * @param {SQLTransaction|null} tx (null) creates auto-transaction
     * @param {function(SQLTransaction)} [successCallback]
     * @param {function(SQLTransaction, SQLError)} [errorCallback]
     */
    DatabaseAdapter.prototype.truncate = function(tableName, tx, successCallback, errorCallback) {
        var self = this;

        // AutoTransaction
        if (this.autoTransaction(tx, function(tx) {
            self.truncate(tableName, tx, successCallback, errorCallback);
        })) {
            return;
        }

        if (!tableName) {
            throw new Error('missing or empty tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }


        this.executeSql(tx, 'DELETE FROM ' + tableName, [],
                        // SUCCESS
                        function(tx, resultSet) {
                            self.ifExistsInDb(self.SQLITE_TABLE_AUTOINCREMENT,
                                              self.SQLITE_TYPE_TABLE, tx, function(tx) {
                                    // AUTOINCREMENT-TABLE EXISTS
                                    self.executeSql(tx, 'DELETE FROM ' +
                                        self.SQLITE_TABLE_AUTOINCREMENT + ' WHERE name=?', [tableName],
                                                    function(tx, resultSet) {
                                                        if (isFunction(successCallback)) {
                                                            successCallback(tx);
                                                        }
                                                    }
                                    );
                                },
                                              // DOESN'T EXISTS
                                              function(tx) {
                                                  if (isFunction(successCallback)) {
                                                      successCallback(tx);
                                                  }
                                              }
                            );
                        },
                        // ERROR
                        function(tx, error) {
                            if (isFunction(errorCallback)) {
                                errorCallback(tx, error);
                            } else {
                                throw new Error(self.SqlError(error));
                            }
                        }
        );
    };


    // ===================================================================================================================
    // ifExistsInDb()
    // ===================================================================================================================
    /**
     * Searches an entity in the sqlite master table and calls a found or notExists callback function.
     * @param {String} name entity name
     * @param {String|null|undefined|Boolean} [type=''] optional type filter for db.SQLITE_TYPE_ types
     * @param {SQLTransaction|null} tx (null) creates an auto transaction
     * @param {function(SQLTransaction)} existsCallback will be called after succeeded search
     * @param {function(SQLTransaction)} notExistsCallback will be called if 'name' (type) doesn't exists
     */
    DatabaseAdapter.prototype.ifExistsInDb = function(name, type, tx, existsCallback, notExistsCallback) {
        var self = this;

        // Auto-Transaction
        if (this.autoTransaction(tx, function(tx) {
            self.ifExistsInDb(name, type, tx, existsCallback, notExistsCallback);
        })) {
            return;
        }

        // TypeCheck
        if (!is('String', name) || '' === name) {
            throw new TypeError('name has to be a non empty string');
        }


        // create SQL
        var sql = 'SELECT COUNT(*) as cnt FROM ' + this.SQLITE_TABLE_MASTER + ' WHERE name = ?', data = [name];

        if (type) {
            if (!is('String', type)) {
                throw new TypeError('type has to be null|undefined|string');
            }

            sql += ' AND type=?';
            data.push(type);
        }

        this.executeSql(tx, sql, data, function(tx, /** SQLResultSet */ resultSet) {
            if (resultSet.rows.length) {
                var row = resultSet.rows.item(0);
                //noinspection JSUnresolvedVariable
                if (row.cnt) {
                    existsCallback(tx);
                    return;
                }
            }

            if (isFunction(notExistsCallback)) {
                notExistsCallback(tx);
            }
        });
    };

    // ===================================================================================================================
    // AutoTransaction
    // ===================================================================================================================
    /**
     * Starts a sql transaction if tx isn't a transaction object and calls a function with arguments.
     *
     * @example <caption>How to use</caption>
     * <pre><code>function doWhatever(tx, ...)
     * {
     *   if (db.autoTransaction(tx, function(tx) { doWhatever(tx, ...); }))
     *   {
     *     return;
     *   }
     *
     *   // tx is a transaction object below
     *   // ...
     * }</code></pre>
     * @param {SQLTransaction|null} tx will be auto generated if not a transaction object
     * @param {function(SQLTransaction)} func the caller function, that has to be called in auto transaction
     * @param {function(SQLError)|SQLTransactionErrorCallback} [errorCallback]
     * @param {function()|SQLVoidCallback} [successCallback]
     * @returns {boolean} if the function returns TRUE the caller HAS TO return to prevent double calls
     */
    DatabaseAdapter.prototype.autoTransaction = function(tx, func, errorCallback, successCallback) {
        if (!tx || !tx.executeSql) {
            this.getConnection().transaction(func, errorCallback, successCallback);
            return true;
        }

        return false;
    }


    // ===================================================================================================================
    // data helper
    // ===================================================================================================================
    /**
     * Returns the placeholder(s) for one, some or all columns of a table.
     * This function must be called for DATE, DATETIME or TIME columns.
     *
     * @param {String} tableName  !table must exists!
     * @param {String|Array} [column] (string) existing column;
     *                                (array) [0...n-1]] existing columns;
     *                                (undefined) all columns
     * @return {String|Array.<String>} (string) sql placeholder for column;
     *                                 (array) [0...n-1] placeholder for given or all columns
     */
    DatabaseAdapter.prototype.getColumnPlaceholder = function(tableName, column) {
        var self = this;

        if (!tableName) {
            throw new Error('missing or empty tableName');
        }
        if (!this.tableExists(tableName)) {
            throw new Error("tableName '" + tableName + "' isn't added/defined.");
        }

        // call with column => return String
        if (is('String', column)) {
            var colType = this.getColumnType(tableName, column), sqlType = this.getSqlColumnType(tableName, column);

            if (_isDateType(colType)) {
                if (!timestampTpl.hasOwnProperty(sqlType)) {
                    throw new Error("ERROR unknown date type '" + colType + "' --> '" + sqlType + "' in " + tableName + '.' + column);
                }

                return timestampTpl[sqlType];
            } else {
                return '?';
            }
        }
        // call a selection of columns => return Array!
        else if (isArray(column)) {
            this.checkColumns(tableName, column);
            //noinspection JSUnresolvedFunction
            return column.map(_columnPlaceholderMapper);
        }
        // call for all columns => return Array!
        else if (undefined === column) {
            var columns = this.getColumns(tableName);
            return columns.map(_columnPlaceholderMapper);
        } else {
            throw new Error('ERROR: unsupported column type (' + (typeof column) + '). ');
        }

        /**
         * @ignore
         * @param {String} col
         * @return {Array.<String>} placeholder array
         * @private
         */
        function _columnPlaceholderMapper(col)
        {
            return self.getColumnPlaceholder(tableName, col);
        }
    };


    /**
     * Prepare an array for sqlite: converts Date-Objects to ISOString.
     *
     * @param {*|Array.<*>} data
     * @return {*}
     */
    DatabaseAdapter.prototype.prepareData = function(data) {
        var type = getType(data);

        if ('Array' === type) {
            //noinspection JSUnresolvedFunction
            return data.map(this.prepareData);
        } else if ('Date' === type) {
            // yyyy-mm-ddThh:ii:ss.mmmZ
            //noinspection JSUnresolvedFunction
            return data.toISOString();
        } else if ('Object' === type) {
            if (!!data.toString) {
                return data.toString();
            } else {
                throw new Error("ERROR: can't handle objects without toString() method for: '" + JSON.stringify(data) + "'");
            }
        } else {
            return data;
        }
    };


    /**
     * Converts a sql date value to a JavaScript date object.
     * @param {Number|String} dbValue ! has to match the timestampType
     * @param {String} [timestampType]
     * @return {Date} if timestampType didn't match the return will be an 'Invalid Date'!
     */
    DatabaseAdapter.prototype.db2date = function(dbValue, timestampType) {
        if (null === dbValue) {
            return null;
        }

        timestampType = timestampType || this.options.timestamp_type;
        var dtType = this.getTypeAffinity(timestampType);

        if (db2dateConverter.hasOwnProperty(dtType)) {
            return db2dateConverter[dtType](dbValue);
        } else {
            throw new Error("Unknown timestampType '" + timestampType + "' --> '" + dtType + "'");
        }
    };


    // ===================================================================================================================
    // public helper
    // ===================================================================================================================
    /**
     * Returns the column/type affinity for a SQLite type.
     *
     * @see http://www.sqlite.org/datatype3.html#affname
     * @param {String} type sql type (of CREATE TABLE or CAST)
     * @return {String} SQLite type [INTEGER|TEXT|NONE|REAL|NUMERIC]
     */
    DatabaseAdapter.prototype.getTypeAffinity = function(type) {
        if (!type || !is('String', type)) {
            return 'NONE';
        }
        type = type.toUpperCase();

        if (type.indexOf('INT') > -1) {
            return 'INTEGER';
        }
        if (type.indexOf('CHAR') > -1 || type.indexOf('TEXT') > -1 || type.indexOf('CLOB') > -1) {
            return 'TEXT';
        }
        if (type.indexOf('BLOB') > -1) {
            return 'NONE';
        }
        if (type.indexOf('REAL') > -1 || type.indexOf('FLOA') > -1 || type.indexOf('DOUB') > -1) {
            return 'REAL';
        }

        return 'NUMERIC';
    };


    /**
     * Returns TRUE if tableName.column is defined as date/time column.
     * @param {String} tableName !must exists!
     * @param {String} column !must exists!
     * @returns {Boolean} TRUE if tableName.column is defined as date/time column; else FALSE
     */
    DatabaseAdapter.prototype.isDateColumn = function(tableName, column) {
        return (column === this.options.timestamp_create)
            || (column === this.options.timestamp_change)
            || _isDateType(this.getColumnType(tableName, column));
    };

    /**
     * @param {String} colType has to be UPPERCASE
     * @return {Boolean} TRUE if colType contains DATE or TIME
     * @private
     */
    function _isDateType(colType)
    {
        return (colType.indexOf('DATE') > -1 || colType.indexOf('TIME') > -1)
    };


    // ===================================================================================================================
    // auto magic helper
    // ===================================================================================================================
    /**
     * Checks table definitions for automagic columns (like dt_create, dt_change) and defines column definitions and trigger.
     * @param {String} tableName !must exists!
     * @private
     */
    DatabaseAdapter.prototype._prepareAutoTableDefinitions = function(tableName) {
        var columns = this.getColumns(tableName), columType = this.options.timestamp_type || 'INTEGER';

        // check for auto_create_timestamp
        if (!!this.options.timestamp_create && columns.indexOf(this.options.timestamp_create) !== -1) {
            this.setColumns(tableName, this.options.timestamp_create, [columType, SQL_DT_CONSTRAINTS]);
        }

        // check for auto_change_timestamp
        if (!!this.options.timestamp_change && columns.indexOf(this.options.timestamp_change) !== -1) {
            this.setColumns(tableName, this.options.timestamp_change, [columType, SQL_DT_CONSTRAINTS]);
            this.addTrigger(tableName + '_dt_create_autoupdate', $.template(SQL_DT_CHANGE_TRIGGER, {table: tableName}));
        }

        this._prepareAutoColumnDefintions(tableName, columns);
    }

    /**
     * internal use only! iterate through table columns
     * @param tableName
     * @param columns
     * @private
     */
    DatabaseAdapter.prototype._prepareAutoColumnDefintions = function(tableName, columns) {
        // iterate through all columns
        for (var t = 0; t < columns.length; t++) {
            var colDef = this._getColumnData(tableName, t);

            // AUTO COLLATION
            if (!!this.options.autoCollate && this.options.autoCollateTypes.test(colDef[1])) {
                if (colDef[2].toUpperCase().indexOf(' COLLATE ') === -1) {
                    colDef[2] += ' COLLATE ' + this.options.autoCollate;
                    this.setColumns(tableName, colDef);
                }
            }
        }

    }


    // ===================================================================================================================
    // column definition helper functions
    // ===================================================================================================================
    /**
     * Returns the array index of columnName in table columns OR -1 if columnName not exists.
     * @param {String} entityName !must exist!
     * @param {String} columnName
     * @return {Number} 0…n-1 for existing columns | -1 for non-existing columns
     * @private
     */
    DatabaseAdapter.prototype._getColumnIndex = function(entityName, columnName) {
        var columns = this._getColumnNames(entityName);
        return (columns.length) ? columns.indexOf(columnName) : -1;
    }


    /**
     * Returns an array with column names for a table or view.
     * @param entityName !must exist!
     * @return {string[]}
     * @private
     */
    DatabaseAdapter.prototype._getColumnNames = function(entityName) {
        var columns = [], entity = this.isTable(entityName) ? this.tables : this.views;
        for (var t = 0; t < entity[entityName].columns.length; t++) {
            columns.push(this._getColumnData(entityName, t, 0));
        }

        return columns;
    }


    /**
     * Returns column definition (or a part of it) for an existing table.column combination.
     * @param {String} entityName !must exist!
     * @param {String|Number} column
     * @param {String|Number} [part] name|type|constraints or 0|1|2
     * @return {Array|String|undefined} (Array) complete column definition (= Array(3));
     *                                  (String) part of column definition;
     *                                  (undefined) unknown/not existing column or part
     * @private
     */
    DatabaseAdapter.prototype._getColumnData = function(entityName, column, part) {
        var
            parts = this.isTable(entityName) ? ['name', 'type', 'constraints'] : ['name', 'type', 'view_alias', 'view_column'],
            entities = this.isTable(entityName) ? this.tables : this.views;

        if ('string' === typeof column) {
            column = this._getColumnIndex(entityName, column);
        }

        if ('string' === typeof part) {
            //noinspection JSValidateTypes
            part = parts.indexOf(part);
        }

        if (column < 0 || column >= entities[entityName].columns.length || part >= parts.length) {
            return undefined;
        }

        return (0 <= part) ? entities[entityName].columns[column][part] : entities[entityName].columns[column];
    }


    // ===================================================================================================================
    // helper functions
    // ===================================================================================================================
    /**
     * Checks an object for connection factory interface.
     *
     * `connectionFactory`:
     * * HAS to be an object
     * * MUST have a function `openDatabase()`
     *
     * @param {Object} connectionFactory
     *
     * @throws TypeError ; for invalid arguments
     *
     * @private
     */
    function _checkConnectionFactory(connectionFactory)
    {
        if (!connectionFactory || !isObject(connectionFactory) ||
            !connectionFactory.openDatabase || 'function' !== typeof connectionFactory.openDatabase) {
            throw new TypeError('conectionFactory has to be a connection factory with `openDatabase` as function');
        }
    }


    /**
     * @param type {string} type to check (e. g. 'undefined', 'null', 'Array', 'Object', 'Function', 'String', 'Number', 'Boolean')
     * @param obj {*} the object
     * @return {boolean}
     */
    function is(type, obj)
    {
        var objClass = getType(obj);
        return objClass === type || objClass.toLowerCase() === type;
    }

    /**
     * @param obj {*} the object
     * @return {boolean} true if `obj` is an array; otherwise false
     */
    function isArray(obj)
    {
        return !!obj && 'Array' === getType(obj);
    }

    /**
     * @param obj {*} the object
     * @return {boolean} true if `obj` is an object; otherwise false
     */
    function isObject(obj)
    {
        return !!obj && obj === Object(obj);
    }

    /**
     * @param obj {*} the object
     * @return {boolean} true if `obj` is a function; otherwise false
     */
    function isFunction(obj)
    {
        return !!obj && 'Function' === getType(obj);
    }

    /**
     * @param obj {*} the object
     * @return {string} type of `obj` (e. g. 'undefined', 'null', 'Array', 'Object', 'Function', 'String', 'Number', 'Boolean')
     */
    function getType(obj)
    {
        if (obj === undefined) {
            return 'undefined';
        }
        if (null === obj) {
            return 'null';
        }
        return Object.prototype.toString.call(obj).slice(8, -1);
    }

    $.DatabaseAdapter = DatabaseAdapter;
})(af, window);
;
