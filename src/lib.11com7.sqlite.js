//noinspection JSCheckFunctionSignatures
/**
 * db - Database-Connector/Helper for SQLite
 *
 * Copyright (c) 2012 11com7, Bonn, Germany
 * Released under the MIT license
 * http://opensource.org/licenses/mit-license.php
 *
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-09-30
 * @namespace af
 */
(/**
 * @param {af} $
 * @param {Window} window
 * @param {undefined} [undefined]
 */
 function($, window, undefined)
{
  "use strict";

  // Privates
  var
    database = null,
    options = {
      name : "",
      version : "0.0",
      displayName : "",
      databaseSize : 5 * 1024 * 1024,
      autoInit : true,
      autoCollate : "NOCASE",
      autoCollateTypes : /^(?:CHAR|VARCHAR|TEXT|CHARACTER)/i,
      dropOnInit : false,
      timestamp_create : 'dt_create',
      timestamp_change : 'dt_change',
      timestamp_type : 'INTEGER',
      debug : false
    },

    sqlLast = '',

    initialized = false,

    tables = {},
    triggers = {},
    indexes = {},
    views = {},

    // templates
    SQL_DT_DEFAULT = "STRFTIME('%s', 'NOW')",
    SQL_DT_CONSTRAINTS = "NOT NULL DEFAULT (" + SQL_DT_DEFAULT + ")",
    SQL_CREATE_TABLE = "CREATE TABLE IF NOT EXISTS <%=table%> (<%=fields%><%=constraints%>);",
    SQL_CREATE_INDEX = "CREATE<%=unique%> INDEX IF NOT EXISTS <%=name%> ON <%=table%> (<%=fields%>);",
    SQL_CREATE_VIEW = "CREATE VIEW IF NOT EXISTS <%=name%> AS <%=select%>;",
    SQL_DROP_TABLE = "DROP TABLE IF EXISTS <%=table%>;",
    SQL_DROP_TRIGGER = "DROP TRIGGER IF EXISTS <%=trigger%>;",
    SQL_DROP_INDEX = "DROP INDEX IF EXISTS <%=index%>;",
    SQL_DROP_VIEW = "DROP VIEW IF EXISTS <%=view%>;",
    SQL_CREATE_TRIGGER = "CREATE TRIGGER IF NOT EXISTS <%=trigger%> <%=definition%>",
    SQL_DT_CHANGE_TRIGGER =  " AFTER UPDATE ON <%=table%> " +
                              "BEGIN " +
                                "UPDATE <%=table%> SET dt_change = " + SQL_DT_DEFAULT + " WHERE new.id = id; " +
                              "END;",

    // Timestamp templates
    timestampTpl = {
      INTEGER : "MAX(0, 1*STRFTIME('%s', ?))", // <-- preserve 0-value as 0 BUT only for dates since 1970-01-01
      TEXT : "STRFTIME('%Y-%m-%d %H:%M:%S', ?)", // <-- 'NOW' needs here an additional modifier ", LOCALTIME"
      NUMERIC : "STRFTIME('%J', ?)"
    },
    db2dateConverter = {
      INTEGER : function(seconds) { return seconds != 0 ? new Date(seconds*1000) : parseInt(seconds, 10);},
      // Safari needs some help (YYYY/MM/DD instead of YYYY-MM-DD)
      TEXT : function(dtstring) { return new Date(dtstring.replace(/-/g,"/")); },
      // Julian Date: unix epoch = 2440587.5 JD + sqlite assumes each day as "[...] exactly 86400 seconds [...]" (see http://www.sqlite.org/lang_datefunc.html)
      NUMERIC : function(juldate) { return new Date((juldate - 2440587.5) * 86400.0 * 1000); }
    },
    readyCallbacks = []
    ;


  /**
   * @namespace
   * @name af.db
   */
  $.db = {};

  Object.defineProperties($.db,
  {
    "SQLITE_TABLE_MASTER" : { value: "sqlite_master", writable: false},
    "SQLITE_TABLE_AUTOINCREMENT" : { value: "sqlite_sequence", writable: false},
    "SQLITE_TYPE_TABLE" : { value: "table", writable: false},
    "SQLITE_TYPE_VIEW" : { value: "view", writable: false},
    "SQLITE_TYPE_TRIGGER" : { value: "trigger", writable: false},
    "SQLITE_TYPE_INDEX" : { value: "index", writable: false}
  });


  // ===================================================================================================================
  //
  // ===================================================================================================================
  /**
   * $.db.Select class definition.
   * @constructor
   */
  $.db.Select = function()
  {
    this.select = "";
    this.from = "";
    this.where = "";
    this.group = "";
    this.having = "";
    this.order = "";
    this.limit = "";
  };

  $.db.Select.prototype =
  {
    constructor : $.db.Select,

    /**
     * Returns the value of an attribute.
     * @param {String} attribute
     * @returns {*}
     */
    get : function(attribute)
    {
      if (!attribute in this) { return undefined; }

      return this[attribute];
    },

    /**
     * Returns the string value of an attribute
     * @param {String} attribute
     * @param {String} [separator]
     * @returns {String}
     */
    getString : function(attribute, separator)
    {
      if (!attribute in this) { return undefined; }

      separator = separator || " ";

      if ($.isArray(this[attribute])) { return this[attribute].join(separator); }
      else if ($.isObject(this[attribute]) && !!this[attribute].toString) { return this[attribute].toString(); }
      else if ($.isFunction(this[attribute])) { return "" + this[attribute](this); }
      else { return "" + this[attribute]; }
    }

  };


  /**
   * (internal) view class (only for jsdoc documentation).
   * @constructor
   */
  $.db.View = function()
  {
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
     * @type {$.db.Select}
     */
    this.select = new $.db.Select();
  }



  // ===================================================================================================================
  // OPEN / CLOSE
  // ===================================================================================================================
  /**
   * Opens the database if necessary and returns the database object.
   * @return {Database|Boolean}
   * name af.db.open()
   */
  $.db.open = function()
  {
    if (!$.db.isOpen())
    {
      _checkOptions();

      try
      {
        database = window.openDatabase(options.name, options.version, options.displayName, options.databaseSize);
        _trigger('SQL:open', database);
        if (!!options.autoInit) { _initDb(); }
      }
      catch (e)
      {
        throw new Error($.db.SqlError(e, "", "openDatabase('" + options.name + "', '" + options.version + "', '" + options.displayName + "', '" + options.databaseSize + "'"));
      }
    }

    return database;
  };

  /**
   * Close the database if opened.
   */
  $.db.close = function()
  {
    if ($.db.isOpen())
    {
      database.close();
      database = null;
      _trigger("SQL:close");
    }
  };

  /**
   * Return TRUE if database is already opened; otherwise FALSE.
   * @return {Boolean}
   */
  $.db.isOpen = function ()
  {
    return !!database;
  };



  // ===================================================================================================================
  // OPTIONS
  // ===================================================================================================================
  /**
   * Set options (object) or one option to value.
   * @param {Object|String} tOptions  (Object) set existing option keys to tOption values;
   *                                  (String) existing option key for single option
   * @param {*} [value] for single option change
   */
  $.db.setOptions = function(tOptions, value)
  {
    if (typeof tOptions === "string")
    {
      if (options.hasOwnProperty(tOptions))
      {
        var key = tOptions;
        tOptions = {};
        tOptions[key] = value;
      }
      else
      {
        throw new Error("unknown option '" + tOptions + "'");
      }
    }

    for (var t in options)
    {
      if (tOptions.hasOwnProperty(t))
      {
        options[t] = tOptions[t];
      }
    }


    if (tOptions.name)  { options.name = tOptions.name; }
  };

  /**
   * Returns one or all db.options (or undefined for non existing key).
   * @param {String} [key] nothing for all options or existing key for option[key]
   * @returns {Object|*|undefined} Object: all Options w/o key argument;
   *                               *: with existing key (option[key]);
   *                               undefined: for non existing keys
   */
  $.db.getOptions = function(key)
  {
    return (key === undefined) ? options : (key && options[key]) ? options[key] : undefined;
  };


  // ===================================================================================================================
  // db.ready()
  // ===================================================================================================================
  /**
   * Fügt Callback-Funktion hinzu, die entweder nach dem Öffnen der Datenbank ausgeführt werden ODER direkt, falls die Datenbank schon geöffnet ist.
   * @param {function(Database)} callback
   */
  $.db.ready = function(callback)
  {
    if (!$.isFunction(callback)) { return; }

    readyCallbacks.push(callback);

    if ($.db.isOpen())
    {
      callback(database);
    }
    else
    {
      $(document).bind("SQL:open", _doDbOpen);
    }

    function _doDbOpen()
    {
      $(document).unbind("SQL:open", _doDbOpen);
      $(document).bind("SQL:close", _doDbClose);

      readyCallbacks.forEach(function(cbFunction) { cbFunction(database); });
    }

    function _doDbClose()
    {
      $(document).unbind("SQL:close", _doDbClose);
      $(document).bind("SQL:open", _doDbOpen);
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
  $.db.addTable = function(tableName, columns, tableConstraints)
  {
    if (!tableName) { throw new Error("missing or empty tableName"); }

    // allow empty tables
    columns = columns || {};

    // allow empty constraints
    tableConstraints = tableConstraints || [];

    tables[tableName] = {'columns':[], 'constraints': []};
    $.db.setColumns(tableName, columns);
    $.db.setTableConstraints(tableName, tableConstraints);

    _prepareAutoTableDefinitions(tableName);
  };

  /**
   * Adds (or overwrite) a trigger.
   * @param triggerName
   * @param trigger
   */
  $.db.addTrigger = function(triggerName, trigger)
  {
    if (!triggerName) { throw new Error("missing or empty triggerName"); }
    if (!trigger) { throw new Error("missing or empty trigger"); }

    triggers[triggerName] = trigger;
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
  $.db.setColumns = function(tableName, columns, definitions)
  {
    if (!tableName) { throw new Error("missing or empty tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }

    if (typeof columns === "string")
    {
      if (!definitions || !definitions.length || definitions.length !== 2)
      {
        throw new Error("Missing or invalid definitions for '" + tableName + "'.'" + columns + "'");
      }

      columns= [[columns, definitions[0], definitions[1]]];
    }
    // pack single column array in outer array
    else if ($.isArray(columns) && columns.length === 3 && !$.isArray(columns[0]))
    {
      columns = [ columns ];
    }

    // columns: [0...n-1]['fieldName', 'type', 'column-constraints']
    var pos;
    for (var t = 0; t < columns.length; t++)
    {
      if (columns[t][1]) { columns[t][1] = columns[t][1].toUpperCase(); } // TYPE to uppercase

      // replace column
      if ((pos = _getColumnIndex(tableName, columns[t][0])) !== -1)
      {
        tables[tableName].columns[pos] = columns[t];
      }
      // add column
      else
      {
        tables[tableName].columns.push(columns[t]);
      }
    }
  };


  /**
   * Set (overwrites) all! table constraints for an existing table.
   *
   * INDEX command:
   * Allows to create an index for a table. Just add a constraint:
   * <code>
   *   ["INDEX", indexName, column(s)]
   *   // column(s) are defined as
   *   // - Array: [columnName0, ..., columnNameN-1] OR
   *   // - String: "columnName" OR "columnName0, ..., columnNameN-1"
   * </code>
   * "PRIMARY KEY" or "UNIQUE" index(es) could be created as normal SQLite constraint.
   *
   * @param tableName
   * @param tableConstraints
   */
  $.db.setTableConstraints = function(tableName, tableConstraints)
  {
    if (!tableName) { throw new Error("missing or empty tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }

    tableConstraints = tableConstraints || [];


    // dom, 2013-01-06: special support for INDEX constraints
    // SQLite doesn't has a INDEX table constraint to create a simple index within a table definition. $.db allows
    // it with the INDEX command.
    tableConstraints = tableConstraints.filter(function(element, index)
    {

      if (element.hasOwnProperty(0) && element[0].toUpperCase() === "INDEX")
      {
        if (element.length < 3) { throw new Error("unsupported INDEX table constraint declaration in " + tableName + ".tableContraints[" + index + "]; NEEDS 3 elements: ['INDEX', indexName, 'field[,fieldN]'|[fields]!"); }
        $.db.addIndex(element[1], tableName, element[2]);

        // remove element
        return false;
      }
      else
      {
        // preserve element
        return true;
      }
    });

    tables[tableName].constraints = tableConstraints;
  };


  // ===================================================================================================================
  // INDEX
  // ===================================================================================================================
  /**
   * Adds (or overwrites) an index.
   * @param {String} indexName
   * @param {String} tableName
   * @param {Array|String} columns Array: [columnName0, ..., columnNameN-1]; String: "columnName" OR "columnName0, ..., columnNameN-1"
   * @param {Boolean} [unique] default: false; create a unique index on true
   */
  $.db.addIndex = function(indexName, tableName, columns, unique)
  {
    if (typeof columns === "string")
    {
      // single column name
      if (columns.indexOf(",") === -1)
      {
        columns = [columns];
      }
      // multiple columns
      else
      {
        columns = columns.split(/\s*,\s*/).filter(function(el) { return !!el; });
      }
    }

    $.db.checkColumns(tableName, columns);

    // add index
    indexes[indexName] =
    {
      table : tableName,
      columns : columns,
      unique : (!!unique) ? " UNIQUE" : ""
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
  $.db.addView = function(viewName, columns, tables, select)
  {
    if (!viewName) { throw new Error("missing or empty viewName"); }
    if (!columns || !columns.length) { throw new Error("missing or empty column array"); }
    if (!tables || !$.isObject(tables)) { throw new Error("missing tables object"); }
    if (!select || !select.from) { throw new Error("missing or empty select object; needs minimal from definition"); }

    views[viewName] =
    {
      "columns" : [],
      "constraints" : [], // <-- always empty!
      "tables" : $.extend({}, tables),
      "select" : $.extend(new $.db.Select(), select)
    };

    /** @type {$.db.View} */
    var viewObj = views[viewName];

    $.db.setViewColumns(viewName, columns);
  };


  /**
   * @param {String} viewName
   * @param {Array} columns Array(name, null|type definition, view_alias [, view_column|SqlClause])
   */
  $.db.setViewColumns = function(viewName, columns)
  {
    if (!viewName) { throw new TypeError("missing or empty viewName"); }
    if (!$.db.isView(viewName)) { throw new TypeError("unknown viewName '" + viewName + "'"); }
    if (!$.isArray(columns))  { throw new TypeError("columns has to be an array instead of (" + $.typeOf(columnsl) + ")"); }


    if ($.isArray(columns) && columns.length > 2 && columns.length < 5 && !$.isArray(columns[0]))
    {
      columns = [ columns ];
    }

    // [ name, null|type definition, view_alias [, view_column|SqlClause] ]
    for (var t=0; t < columns.length; t++)
    {
      var foreignEntity, colType,
        alias = columns[t][2],
        col = columns[t][0], 
        foreignCol = (!!columns[t][3]) ? columns[t][3] : col;


      // FIND FOREIGN ENTITY
      if (!alias)
      {
        throw new TypeError("Missing/empty table alias for " + viewName + "." + col);
      }

      // table alias?
      if (alias in views[viewName].tables)
      {
        foreignEntity = _viewAlias2Entity(viewName, alias);
      }
      else
      {
        throw new TypeError("unknown entity alias '" + alias + "' for " + viewName + "." + col);
      }
      
      
      // CHECK FOREIGN COLUMN
      if (!$.db.columnExists(foreignEntity, foreignCol))
      {
        throw new TypeError("missing foreign column '" + foreignEntity + "'.'" + foreignCol + "' for " + viewName + "." + col);
      }


      // FIND TYPE DEFINITIONS
      if (!columns[t][1])
      {
        colType = _getColumnData(foreignEntity, foreignCol, "type");
      }
      else if ($.is("String", columns[t][1]))
      {
        colType = columns[t][1];
      }
      else
      {
        throw new TypeError("unknown column type definition '" + columns[t][1] + "' for " + viewName + "." + col);
      }


      columns[t] = [col, colType, alias, foreignCol];
      var pos = _getColumnIndex(viewName, col);
      // replace column
      if (pos !== -1)
      {
        views[viewName].columns[pos] = columns[t];
      }
      // add column
      else
      {
        views[viewName].columns.push(columns[t]);
      }
    }
  }


  /**
   * (internal) Returns an entity name (table or view) for an alias.
   * @param {String}viewName existing view
   * @param {String} alias existing entity alias
   * @returns {String}
   */
  function _viewAlias2Entity(viewName, alias)
  {
    return views[viewName].tables[alias];
  }

  /**
   * @param {String}viewName existing view
   * @return {String} SELECT string for a view
   */
  function _createViewSelect(viewName)
  {
    if (!viewName) { throw new TypeError("missing or empty viewName"); }
    if (!$.db.isView(viewName)) { throw new TypeError("unknown viewName '" + viewName + "'"); }

    var sql = "SELECT ", t, tmp,
      /** @type {$.db.View} */
      view = views[viewName],
      /** @type {Array} */
      columns = [],
      tables = [],
      select = [];


    // SELECT [ALL|DISTINCT]
    tmp = view.select.getString("select");
    sql += (tmp) ? tmp + " " : "";

    // COLUMNS
    for (t = 0; t < view.columns.length; t++)
    {
      var col = view.columns[t];
      columns.push(col[2] + "." + col[3] + (col[0] != col[3] ? " AS " + col[0] : ""));
    }
    sql += columns.join(", ") + " ";

    // FROM
    tmp = view.select.getString("from");
    for (var alias in view.tables)
    {
      tmp = tmp.replace("["+alias+"]", view.tables[alias] + " as " + alias);
    }
    sql += "FROM " + tmp + " ";

    // WHERE
    tmp = view.select.getString("where");
    sql += tmp ? "WHERE " + tmp + " " : "";

    // GROUP BY
    tmp = view.select.getString("group");
    sql += tmp ? "GROUP BY " + tmp + " " : "";

    // HAVING
    tmp = view.select.getString("having");
    sql += tmp ? "HAVING " + tmp + " " : "";

    // ORDER BY
    tmp = view.select.getString("order");
    sql += tmp ? "ORDER BY " + tmp + " " : "";

    // LIMIT
    tmp = view.select.getString("limit");
    sql += tmp ? "LIMIT " + tmp + " " : "";

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
  $.db.getTables = function(tableName)
  {
    return (!tableName) ? Object.keys(tables) : ($.db.tableExists(tableName)) ? tables[tableName] : undefined;
  };

  /**
   * Returns an array of all table names or the definitions (object) for one table, if viewName is an existing table; otherwise undefined.
   * @param {String} [viewName]
   * @return {Array|Object|undefined}
   */
  $.db.getViews = function(viewName)
  {
    return (!viewName) ? Object.keys(views) : ($.db.tableExists(viewName)) ? views[viewName] : undefined;
  };

  /**
   * Returns an array of all tables and views OR the definitions (object) for a table or view OR undefined if unknown.
   * @param {String} [entityName]
   * @returns {Array|Object|undefined}
   */
  $.db.getEntities = function(entityName)
  {
    if (!entityName)
    {
      return Object.keys(tables).concat(Object.keys(views));
    }
    else
    {
      if ($.db.isTable(entityName))
      {
        return tables[entityName];
      }
      else if ($.db.isView(entityName))
      {
        return views[entityName];
      }
    }

    return undefined;
  };

  /**
   * Returns all table definitions.
   * @return {Object} {tableName : tableDefinition, ...}
   */
  $.db.getAllTableDefinitions = function()
  {
    var definitions = {}, tables = $.db.getTables();

    for (var t=0; t < tables.length; t++)
    {
      definitions[tables[t]] = $.db.getTables(tables[t]);
    }

    return definitions;
  };

  /**
   * Returns an array of all column names for an existing table OR the column definitions (Object) OR undefined for missing tables/columns.
   * @param {String} tableName
   * @param {String} [column]
   * @return {Array|Object|undefined}
   */
  $.db.getColumns = function(tableName, column)
  {
    if (!tableName) { throw new Error("missing tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }

    if (!column)
    {
      return _getColumnNames(tableName);
    }
    else
    {
      var index = _getColumnIndex(tableName, column);
      return (index > -1) ? _getColumnData(tableName, index) : undefined;
    }
  };

  /**
   * Returns column type for an existing table.column definition.
   * @param {String} tableName
   * @param {String} column
   * @return {String}
   */
  $.db.getColumnType = function(tableName, column)
  {
    if (!tableName) { throw new Error("missing tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }
    if (!column) { throw new Error("missing column"); }

    var index = _getColumnIndex(tableName, column);
    if (index === -1) { throw new Error("column '" + tableName + "'.'" + column + "' isn't added/defined."); }

    return _getColumnData(tableName, index, "type");
  };

  /**
   * Returns TRUE if the tableName is a defined table; otherwise FALSE.
   * @param {String} tableName
   * @return {Boolean}
   * @see $.db.tableExists()
   */
  $.db.isTable = function(tableName)
  {
    return $.db.tableExists(tableName, true);
  };

  /**
   * Returns TRUE if the viewName is a defined view; otherwise FALSE.
   * @param {String} viewName
   * @return {Boolean}
   * @see $.db.tableExists()
   */
  $.db.isView = function(viewName)
  {
    return (viewName && views[viewName]);
  };

  /**
   * Returns TRUE if the indexName is a defined index; otherwise FALSE.
   * @param {String} indexName
   * @return {Boolean}
   */
  $.db.isIndex = function(indexName)
  {
    return (indexName && indexes[indexName]);
  };

  /**
   * Returns TRUE if the entityName (table OR view) is a defined view; otherwise FALSE.
   * @param {String} entityName
   * @return {Boolean}
   * @see $.db.tableExists()
   */
  $.db.isEntity = function(entityName)
  {
    return $.db.tableExists(tableName);
  };

  /**
   * Returns TRUE if the table (or view) is added/defined; otherwise FALSE.
   * @param {String} tableName
   * @param {boolean} [strict] if TRUE it will only return true for tables; default: false
   * @return {Boolean}
   * @see $.db.isTable()
   */
  $.db.tableExists = function(tableName, strict)
  {
    return (tableName && (tables[tableName] || (!strict && views[tableName])));
  };

  /**
   * Returns TRUE if the table is added/defined; otherwise FALSE.
   * @param {String} viewName
   * @return {Boolean}
   */
  $.db.viewExists = function(viewName)
  {
    return (viewName && views[viewName]);
  };


 /**
   * Returns TRUE if the entity (table or view) is added/defined; otherwise FALSE.
   * @param {String} entityName
   * @return {Boolean}
   */
  $.db.entityExists = function(entityName)
  {
    return $.db.tableExists(entityName);
  };

  /**
   * Returns TRUE if the column (and table or view) is added/defined; otherwise FALSE.
   * @param {String} entityName
   * @param {String} column
   * @return {Boolean}
   */
  $.db.columnExists = function(entityName, column)
  {
    return ($.db.entityExists(entityName) && column && _getColumnIndex(entityName, column) > -1);
  };


  /**
   * Checks an array with column names for a defined table (or view) and throws Error on non-defined columns.
   * @param {String} entityName
   * @param {Array} columns
   * @throws Error
   */
  $.db.checkColumns = function(entityName, columns)
  {
    if (!entityName) { throw new Error("missing tableName"); }
    if (!$.db.entityExists(entityName)) { throw new Error("tableName '" + entityName + "' isn't added/defined."); }
    if (!columns || !$.isArray(columns)) { throw new Error("columns is '" + (typeof columns) + "' instead of an array"); }

    var lastCol=null;
    if (!columns.every(function(col) { lastCol = col; return $.db.columnExists(entityName, col); }))
    {
      throw new Error("column '" + lastCol + "' doesn't exists in '" + entityName + "'");
    }
  };


  /**
   * Returns the database (if it isn't already opened, getDatabase will open the database).
   * @return {Database}
   */
  $.db.getDatabase = function()
  {
    if (!$.db.isOpen())
    {
      $.db.initDb();
    }

    return database;
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
  $.db.initDb = function(tx, forceReInit, readyCallback)
  {
    if (forceReInit === true)  { initialized = false };

    if (initialized)  { return; }

    if (!$.db.isOpen())
    {
      if (!options.autoInit)
      { //noinspection JSCheckFunctionSignatures,JSValidateTypes
        $(document).on("SQL:open", _initDb)
      }

      $.db.open();
    }
    else
    {
      _initDb(tx, readyCallback);
    }
  };

  function _initDb(tx, readyCallback)
  {
    if (!$.db.isOpen()) { throw new Error("database not opened"); }

    var sql = "",
      tables = $.db.getTables();

    // autotransaction if needed
    if ($.db.autoTransaction(tx, function(tx) { _initDb(tx, readyCallback); } ))
    { return; }

    // ---------- tx exists -----------------------------------------
    // Tables
    sql = "::tables";
    for (var t = 0; t < tables.length; t++)
    {
      $.db.createTable(tx, tables[t]);
    }

    // Triggers
    sql = "::triggers";
    for (var trigger in triggers)
    {
      if (triggers.hasOwnProperty(trigger))
      {
        $.db.createTrigger(tx, trigger);
      }
    }

    // Indexes
    sql = "::indexes";
    for (var index in indexes)
    {
      if (indexes.hasOwnProperty(index))
      {
        $.db.createIndex(tx, index);
      }
    }

    // Views
    sql = "::views";
    for (var view in views)
    {
      if (views.hasOwnProperty(view))
      {
        $.db.createView(tx, view);
      }
    }

    initialized = true;
    if ($.isFunction(readyCallback)) { readyCallback(tx); }
  }


  /**
   * Creates a table entity in the database.
   * @param {SQLTransaction} tx transaction object
   * @param {String} tableName table name
   * @param {Boolean} [force] (default: false); DROPS the table if true!
   */
  $.db.createTable = function(tx, tableName, force)
  {
    var sql;

    if (!!options.dropOnInit || !!force)
    {
      sql = $.template(SQL_DROP_TABLE, {'table' : tableName});
      $.db.executeSql(tx, sql);
    }

    sql = $.db.getSqlTable(tableName);
    $.db.executeSql(tx, sql);
  };

  /**
   * Creates a named trigger in the database.
   * @param {SQLTransaction} tx transaction object
   * @param {String} trigger trigger name
   * @param {Boolean} [force] (default: false); DROPS the table if true!
   */
  $.db.createTrigger = function(tx, trigger, force)
  {
    var sql;

    if (!!options.dropOnInit || !!force)
    {
      sql = $.template(SQL_DROP_TRIGGER, {'trigger' : trigger});
      $.db.executeSql(tx,sql);
    }

    sql = $.template(SQL_CREATE_TRIGGER, {'trigger' : trigger,  'definition' : triggers[trigger] });
    $.db.executeSql(tx,sql);
  };

  /**
   * Creates a named index in the database.
   * @param {SQLTransaction} tx transaction object
   * @param {String} index index name
   * @param {Boolean} [force] (default: false); DROPS the table if true!
   */
  $.db.createIndex = function(tx, index, force)
  {
    var sql;

    if (!$.db.isIndex(index))
    {
      throw new TypeError("unknown index: '" + index + "' (" + $.typeOf(index) + ")");
    }

    if (!!options.dropOnInit || !!force)
    {
      sql = $.template(SQL_DROP_INDEX, {'index' : index});
      $.db.executeSql(tx, sql);
    }

    sql = $.template(SQL_CREATE_INDEX, {'name' : index, 'unique' : indexes[index].unique, 'table' : indexes[index].table, 'fields' : indexes[index].columns.join(", ") });
    $.db.executeSql(tx, sql);
  };

  /**
   * Creates a view in the database.
   * @param {SQLTransaction} tx transaction object
   * @param {String} name viewName
   * @param {Boolean} [force] if TRUE the view will be dropped an re-created; default: false
   */
  $.db.createView = function(tx, name, force)
  {
    var sql;

    if (!!options.dropOnInit || !!force)
    {
      sql = $.template(SQL_DROP_VIEW, {'view' : name});
      $.db.executeSql(tx, sql);
    }

    sql = $.template(SQL_CREATE_VIEW, {'name' : name, 'select' : _createViewSelect(name)});
    $.db.executeSql(tx, sql);
  };



  /**
   * Returns sql string with column definition statement.
   * @param {String} tableName table name
   * @return {String}
   * @private
   */
  function _getSqlTableColumns(tableName)
  {
    var sqlColumns = [], columns = $.db.getColumns(tableName), t;

    for (t=0; t < columns.length; t++)
    {
      sqlColumns.push( $.db.getSqlColumn(tableName, columns[t]) );
    }

    return sqlColumns.join(", ");
  }

  /**
   * Returns sql string with table constraints definitions.
   * @param {String} tableName table name
   * @return {String}
   * @private
   */
  function _getSqlTableConstraints(tableName)
  {
    return (tables[tableName].constraints && tables[tableName].constraints.length > 0) ? ", " + tables[tableName].constraints.join(", ") : '';
  }


  // ===================================================================================================================
  // DB SQL
  // ===================================================================================================================
  /**
   * Returns a SQL string for a (existing) table.
   * @param {String} tableName table name
   * @return {String}
   */
  $.db.getSqlTable = function(tableName)
  {
    return $.template(SQL_CREATE_TABLE, {'table' : tableName, 'fields' : _getSqlTableColumns(tableName), 'constraints' : _getSqlTableConstraints(tableName) });
  }


  /**
   * Returns a SQL string for a (existing) table#column.
   * @param {String} tableName table name
   * @param {String} column column name
   * @return {String}
   */
  $.db.getSqlColumn = function(tableName, column)
  {
    var columnData = _getColumnData(tableName, column).slice(0); // <-- CREATE COPY!

    // TYPE: convert to sql type (needed for auto date magic handling)
    columnData[1] = $.db.getSqlColumnType(tableName, column);

    return columnData.join(' ');
  }


  /**
   * Returns a SQLite type (DATE/TIME types will be changed to the SQLite type affinity of options.timestamp_type).
   * @param {String} tableName !must exists!
   * @param {String} column !must exists!
   * @return {String} SQLite type
   */
  $.db.getSqlColumnType = function(tableName, column)
  {
    var colType = $.db.getColumnType(tableName, column);
    return $.db.getTypeAffinity(_isDateType(colType) ? options.timestamp_type : colType);
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
  $.db.executeSql = function(tx, sql, data, successCallback, errorCallback)
  {
    // no transaction
    if (!tx || typeof tx !== "object" || !tx.executeSql)
    {
      $.db.getDatabase().transaction(function(tx)
      {
        $.db.executeSql(tx, sql, data, successCallback, errorCallback);
      });
      return;
    }

    // change arguments if data is successCallback
    if ($.isFunction(data) && typeof errorCallback === "undefined")
    {
      //noinspection JSValidateTypes
      errorCallback = successCallback;
      //noinspection JSValidateTypes
      successCallback = data;
      data = [];
    }
    else
    {
      data = !!data ? data : [];
    }

    successCallback = $.isFunction(successCallback) ? successCallback : undefined;
    errorCallback = $.isFunction(errorCallback) ? errorCallback : undefined;

    /** @type {SQLTransaction} tx */
    sqlLast = sql;
    if (options.debug) { $.db.dbg("", sql, data); }

    //noinspection JSValidateTypes
    tx.executeSql(sql, data, successCallback, errorCallback);
  };


  // ===================================================================================================================
  // DEBUG & EXCEPTIONS
  // ===================================================================================================================
  //noinspection JSCommentMatchesSignature
  /**
   * debugs any values to console.log (if exists && options.debug)
   * @param {...*} arguments
   */
  $.db.dbg = function()
  {
    if (options.debug && console && console.log)
    {
      console.log.apply(console, arguments);
    }
  };

  /**
   * (Factory) Creates a new Error/Exception object for a sql error.
   * This function will show the last sql statement, if $.db.executeSql() is used
   * @see $.db.executeSql()
   * @param {SQLError|SQLException|Error} errorObject
   * @param {String} [sql]
   * @param {String} [comment]
   * @return {String}
   */
  $.db.SqlError = function(errorObject, sql, comment)
  {
    // if there is no code entry this will be a »normal« exception
    if (!!errorObject && !errorObject.code && errorObject.message)
    {
      return errorObject.message;
    }

    sql = sql || "sqlLast: »" + sqlLast + "«";
    comment = comment || "";

    var
      code = (!!errorObject && !!errorObject.code) ? errorObject.code : -424242,
      msg = (!!errorObject && !!errorObject.message) ? errorObject.message : "?unknown?";

    return "SQL ERROR #" + code + ": " + msg + " in '" + sql + "' --- " + comment;
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
   * @param {Object} [options] "onConflict":[ROLLBACK|ABORT|FAIL|IGNORE|REPLACE]
   */
  $.db.insertMultiRows = function(tableName, columns, rows, tx, readyCallback, errorCallback, options)
  {
    // start transaction if necessary
    if (typeof tx !== "object")
    {
      $.db.getDatabase().transaction(function(tx)
      {
        $.db.insertMultiRows(tableName, columns, rows, tx, readyCallback, errorCallback, options);
      });
      return;
    }

    if (!tableName) { throw new Error("missing or empty tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }

    $.db.checkColumns(tableName, columns);

    readyCallback = $.isFunction(readyCallback) ? readyCallback : undefined;
    errorCallback = $.isFunction(errorCallback) ? errorCallback : undefined;

    // fix for SQLITE ERROR #5: too many SQL variables (see http://www.sqlite.org/limits.html#max_variable_number)
    // fixed max 500 UNION statements per compound statement (see http://www.sqlite.org/limits.html#max_compound_select)
    var startRow = 0, rowsPerInsert = Math.min(Math.round(900 / columns.length), 499);
    _insertRowChunks();

    function _insertRowChunks()
    {
      var end = startRow + rowsPerInsert,
        chunkRows = rows.slice(startRow, end),
        sql = $.db.createSqlInsertMultiRows(tableName, columns, chunkRows, options),
        sqlValues = [];

      startRow += rowsPerInsert;

      for (var t = 0; t < chunkRows.length; t++)
      {
        var colsData = $.db.prepareData(chunkRows[t]);
        for (var tt = 0; tt < colsData.length; tt++)
        {
          sqlValues.push(colsData[tt]);
        }
      }

      //noinspection JSValidateTypes
      $.db.executeSql(tx, sql, sqlValues, (end > rows.length) ? readyCallback : _insertRowChunks, errorCallback);
    }
  };

  /**
   * Generates a SQL-String for multi inserts based on INSERT INTO … + n-1 * UNION ALL SELECT ….
   * @param {String} tableName
   * @param {Array} columns
   * @param {Array} rows has to be an array with data arrays [[colData1, ..., colDataN], [...]]
   * @param {Object} [options] "onConflict":[ROLLBACK|ABORT|FAIL|IGNORE|REPLACE]
   * @return {String}
   */
  $.db.createSqlInsertMultiRows = function(tableName, columns, rows, options)
  {
    if (!rows || !rows.length || rows.length < 1) { return ""; }
    if (columns.length * rows.length > 999) { throw new Error("maximum number of place-holder variables (" + (columns.length * rows.length) + ") will be greater then 999"); }

    options = options || {};

    var
      onConflict = !!options.onConflict ? " OR " + options.onConflict.trim().toUpperCase() : "",
      sql = "INSERT" + onConflict + " INTO " + tableName + "(" + columns.join(',') + ") ";


    // first row as select
    var asTmp = [], placeholders = [], placeholder;
    for (var t=0; t < columns.length; t++)
    {
      placeholder = $.db.getColumnPlaceholder(tableName, columns[t]);
      asTmp.push(placeholder + " as " + columns[t]);
      placeholders.push(placeholder);
    }

    sql += " SELECT " + asTmp.join(",");

    // then add the next rows as UNION ALL SELECT
    asTmp = [];
    placeholder = placeholders.join(", ");
    for (t=1; t < rows.length; t++)
    {
      asTmp.push("UNION ALL SELECT " + placeholder);
    }

    sql += " " + asTmp.join(" ");

    return sql;
  };


  // ===================================================================================================================
  // DROP DATABASE (polyfill)
  // ===================================================================================================================
  /**
   * This function will delete every deletable table, view, index, trigger and resets the sqlite_sequence table.
   * As there isn't a way to drop the database with JavaScript, this function is just a polyfill.
   * @param {SQLTransaction} [tx] the functions creates a SQLTransaction if necessary
   */
  $.db.dropDatabase = function(tx, readyCallback)
  {
    if ($.db.autoTransaction(tx, function(tx) { $.db.dropDatabase(tx, readyCallback) } ))
    { return; }


    /** @type {SQLTransaction} tx */
    $.db.executeSql(tx, "SELECT type,name FROM sqlite_master", [],
      // SUCCESS
      function(tx, results)
      {
        // ignore this entities
        var
          ignoreNames =
          {
            "__WebKitDatabaseInfoTable__" : true,
            "sqlite_autoindex___WebKitDatabaseInfoTable___1" : true
          },
          sqliteSequenceExists = false
          ;

        ignoreNames[$.db.SQLITE_TABLE_AUTOINCREMENT] = true;

        // delete all table, trigger, indexes, views (ignore the entities above)
        for (var t = 0; t < results.rows.length; t++)
        {
          var name = results.rows.item(t).name;
          if (!ignoreNames.hasOwnProperty(name))
          {
            $.db.executeSql(tx, "DROP " + results.rows.item(t).type + " IF EXISTS " + name, null);
          }
          else if(name === $.db.SQLITE_TABLE_AUTOINCREMENT)
          {
            sqliteSequenceExists = true;
          }
        }

        if (sqliteSequenceExists)
        {
          $.db.executeSql(tx, "DELETE FROM " + $.db.SQLITE_TABLE_AUTOINCREMENT + " WHERE name=name", [], readyCallback); // delete all auto ids
        }
        else
        {
          $.db.executeSql(tx, "SELECT null", [], readyCallback);
        }
      },
      // ERROR
      _dbError
    );

    function _dbError(tx, error)
    {
      throw new Error($.db.SqlError(error));
    }
  };


  // ===================================================================================================================
  // truncate (shim)
  // ===================================================================================================================
  /**
   * Empties a table completely and resets it's autoincrement counter if exists.
   * @param {String} tableName Table OR ViewName
   * @param {SQLTransaction|null} tx (null) creates auto-transaction
   * @param {function(SQLTransaction)} [successCallback]
   * @param {function(SQLTransaction, SQLError)} [errorCallback]
   */
  $.db.truncate = function(tableName, tx, successCallback, errorCallback)
  {
    // AutoTransaction
    if ($.db.autoTransaction(tx, function(tx) { $.db.truncate(tableName, tx, successCallback, errorCallback); }))
    { return; }

    if (!tableName) { throw new Error("missing or empty tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }


    $.db.executeSql(tx, "DELETE FROM " + tableName, [],
    // SUCCESS
    function(tx, resultSet)
    {
      $.db.ifExistsInDb($.db.SQLITE_TABLE_AUTOINCREMENT, $.db.SQLITE_TYPE_TABLE, tx, function(tx)
        // AUTOINCREMENT-TABLE EXISTS
        {
          $.db.executeSql(tx, "DELETE FROM " + $.db.SQLITE_TABLE_AUTOINCREMENT + " WHERE name=?", [tableName],
            function(tx, resultSet)
            {
              if ($.isFunction(successCallback)) { successCallback(tx);  }
            });
        },
        // DOESN'T EXISTS
        function(tx)
        {
          if ($.isFunction(successCallback)) { successCallback(tx); }
        }
      );
    },
    // ERROR
    function(tx, error)
    {
      if ($.isFunction(errorCallback))
      {
        errorCallback(tx, error);
      }
      else
      {
        throw new Error($.db.SqlError(error));
      }
    });
  };



  // ===================================================================================================================
  // ifExistsInDb()
  // ===================================================================================================================
  /**
   * Searches an entity in the sqlite master table and calls a found or notExists callback function.
   * @param {String} name entity name
   * @param {String|null|undefined|Boolean} [type=""] optional type filter for $.db.SQLITE_TYPE_ types
   * @param {SQLTransaction|null} tx (null) creates an auto transaction
   * @param {function(SQLTransaction)} existsCallback will be called after succeeded search
   * @param {function(SQLTransaction)} notExistsCallback will be called if 'name' (type) doesn't exists
   */
  $.db.ifExistsInDb = function(name, type, tx, existsCallback, notExistsCallback)
  {
    // Auto-Transaction
    if ($.db.autoTransaction(tx, function(tx) { $.db.ifExistsInDb(name, type, tx, existsCallback, notExistsCallback); }))
    { return; }

    // TypeCheck
    if (!$.is("String", name) || name === "") { throw new TypeError("name has to be a non empty string"); }


    // create SQL
    var sql = "SELECT COUNT(*) as cnt FROM " + $.db.SQLITE_TABLE_MASTER + " WHERE name = ?", data=[name];

    if (type)
    {
      if (!$.is("String", type)) { throw new TypeError("type has to be null|undefined|string"); }

      sql += " AND type=?";
      data.push(type);
    }

    $.db.executeSql(tx, sql, data, function(tx, /** SQLResultSet */ resultSet)
    {
      if (resultSet.rows.length)
      {
        var row = resultSet.rows.item(0);
        if (row.cnt)
        {
          existsCallback(tx);
          return;
        }
      }

      if ($.isFunction(notExistsCallback)) { notExistsCallback(tx); }
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
   *   if ($.db.autoTransaction(tx, function(tx) { doWhatever(tx, ...); }))
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
   * @name af.db.autoTransaction()
   */
  $.db.autoTransaction = function(tx, func, errorCallback, successCallback)
  {
    if (!tx || !tx.executeSql || typeof tx === "undefined")
    {
      $.db.getDatabase().transaction(func, errorCallback, successCallback);
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
   * @param {String} tableName  !table must exists!
   * @param {String|Array} [column] (string) existing column;
   *                                (array) [0...n-1]] existing columns;
   *                                (undefined) all columns
   * @return {String|Array.<String>} (string) sql placeholder for column;
   *                                 (array) [0...n-1] placeholder for given or all columns
   */
  $.db.getColumnPlaceholder = function(tableName, column)
  {
    if (!tableName) { throw new Error("missing or empty tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }

    // call with column => return String
    if ($.is("String", column))
    {
      var colType = $.db.getColumnType(tableName, column), sqlType = $.db.getSqlColumnType(tableName, column);

      if (_isDateType(colType))
      {
        if (!timestampTpl.hasOwnProperty(sqlType))
        {
          throw new Error("ERROR unknown date type '" + colType + "' --> '" + sqlType + "' in " + tableName + "." + column);
        }

        return timestampTpl[sqlType];
      }
      else
      {
        return "?";
      }
    }
    // call a selection of columns => return Array!
    else if ($.is("Array", column))
    {
      $.db.checkColumns(tableName, column);
      //noinspection JSUnresolvedFunction
      return column.map( _columnPlaceholderMapper );
    }
    // call for all columns => return Array!
    else if (typeof column === "undefined")
    {
      var columns = $.db.getColumns(tableName);
      return columns.map( _columnPlaceholderMapper );
    }
    else
    {
      throw new Error("ERROR: unsupported column type (" + (typeof column) + "). ");
    }

    /**
     * @ignore
     * @param {String} col
     * @return {Array.<String>} placeholder array
     * @private
     */
    function _columnPlaceholderMapper(col) { return $.db.getColumnPlaceholder(tableName, col); }
  };


  /**
   * Prepare an array for sqlite: converts Date-Objects to ISOString.
   * @param {*|Array.<*>} data
   * @return {*}
   */
  $.db.prepareData = function(data)
  {
    var type = $.typeOf(data);

    if (type === "Array")
    {
      //noinspection JSUnresolvedFunction
      return data.map( $.db.prepareData );
    }
    else if (type === "Date")
    {
      // yyyy-mm-ddThh:ii:ss.mmmZ
      //noinspection JSUnresolvedFunction
      return data.toISOString();
    }
    else if (type === "Object")
    {
      if (!!data.toString)
      {
        return data.toString();
      }
      else
      {
        throw new Error("ERROR: can't handle objects without toString() method for: '" + JSON.stringify(data) + "'");
      }
    }
    else
    {
      return data;
    }
  };


  /**
   * Converts a sql date value to a JavaScript date object.
   * @param {Number|String} dbValue ! has to match the timestampType
   * @param {String} [timestampType]
   * @return {Date} if timestampType didn't match the return will be an "Invalid Date"!
   */
  $.db.db2date = function(dbValue, timestampType)
  {
    if (dbValue === null) { return null; }

    timestampType = timestampType || options.timestamp_type;
    var dtType = $.db.getTypeAffinity(timestampType);

    if (db2dateConverter.hasOwnProperty(dtType))
    {
      return db2dateConverter[dtType](dbValue);
    }
    else
    {
      throw new Error("Unknown timestampType '" + timestampType + "' --> '" + dtType +"'");
    }
  };



  // ===================================================================================================================
  // public helper
  // ===================================================================================================================
  /**
   * Returns the column/type affinity for a SQLite type.
   * @see http://www.sqlite.org/datatype3.html#affname
   * @param {String} type sql type (of CREATE TABLE or CAST)
   * @return {String} SQLite type [INTEGER|TEXT|NONE|REAL|NUMERIC]
   */
  $.db.getTypeAffinity = function(type)
  {
    if (!type || !$.is("String", type))  { return "NONE"; }
    type = type.toUpperCase();

    if (type.indexOf("INT") > -1)  { return "INTEGER"; }
    if (type.indexOf("CHAR") > -1 ||type.indexOf("TEXT") > -1 ||type.indexOf("CLOB") > -1)  { return "TEXT"; }
    if (type.indexOf("BLOB") > -1)  { return "NONE"; }
    if (type.indexOf("REAL") > -1 ||type.indexOf("FLOA") > -1 ||type.indexOf("DOUB") > -1)  { return "REAL"; }

    return "NUMERIC";
  };


  /**
   * Returns TRUE if tableName.column is defined as date/time column.
   * @param {String} tableName !must exists!
   * @param {String} column !must exists!
   * @returns {Boolean} TRUE if tableName.column is defined as date/time column; else FALSE
   */
  $.db.isDateColumn = function(tableName, column)
  {
    return (column == options.timestamp_create)
      || (column == options.timestamp_change)
      || _isDateType( $.db.getColumnType(tableName, column) );
  };

  /**
   * @param {String} colType has to be UPPERCASE
   * @return {Boolean} TRUE if colType contains DATE or TIME
   * @private
   */
  function _isDateType(colType)
  {
    return (colType.indexOf("DATE") > -1 || colType.indexOf("TIME") > -1)
  };


  // ===================================================================================================================
  // auto magic helper
  // ===================================================================================================================
  //noinspection FunctionWithMoreThanThreeNegationsJS
  /**
   * Checks table definitions for automagic columns (like dt_create, dt_change) and defines column definitions and trigger.
   * @param {String} tableName !must exists!
   * @private
   */
  function _prepareAutoTableDefinitions(tableName)
  {
    var columns = $.db.getColumns(tableName), cType = options.timestamp_type || "INTEGER";

    // check for auto_create_timestamp
    //noinspection JSValidateTypes
    if (!!options.timestamp_create && columns.indexOf(options.timestamp_create) !== -1)
    {
      $.db.setColumns(tableName, options.timestamp_create, [cType, SQL_DT_CONSTRAINTS]);
    }

    // check for auto_change_timestamp
    //noinspection JSValidateTypes
    if (!!options.timestamp_change && columns.indexOf(options.timestamp_change) !== -1)
    {
      $.db.setColumns(tableName, options.timestamp_change, [cType, SQL_DT_CONSTRAINTS]);
      $.db.addTrigger(tableName+'_dt_create_autoupdate', $.template(SQL_DT_CHANGE_TRIGGER, {table: tableName}));
    }

    _prepareAutoColumnDefintions(tableName, columns);
  }

  /**
   * internal use only! iterate through table columns
   * @param tableName
   * @param columns
   * @private
   */
  function _prepareAutoColumnDefintions(tableName, columns)
  {
    // iterate through all columns
    for (var t=0; t < columns.length; t++)
    {
      var colDef = _getColumnData(tableName, t);

      // AUTO COLLATION
      if (!!options.autoCollate && options.autoCollateTypes.test(colDef[1]))
      {
        if (colDef[2].toUpperCase().indexOf(" COLLATE ") === -1)
        {
          colDef[2] += " COLLATE " + options.autoCollate;
          $.db.setColumns(tableName, colDef);
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
   * @return {Number}
   * @private
   */
  function _getColumnIndex(entityName, columnName)
  {
    var columns = _getColumnNames(entityName);
    //noinspection JSValidateTypes
    return (columns.length) ? columns.indexOf(columnName) : -1;
  }


  /**
   * Returns an array with column names for a table or view.
   * @param entityName !must exist!
   * @return {Array}
   * @private
   */
  function _getColumnNames(entityName)
  {
    var columns = [], entity = $.db.isTable(entityName) ? tables : views;
    for (var t=0; t < entity[entityName].columns.length; t++)
    {
      columns.push(_getColumnData(entityName, t, 0));
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
  function _getColumnData(entityName, column, part)
  {
    var
      parts = $.db.isTable(entityName) ? ["name", "type", "constraints"] : ["name", "type", "view_alias", "view_column"],
      entities = $.db.isTable(entityName) ? tables : views;

    if (typeof column === "string")
    {
      column = _getColumnIndex(entityName, column);
    }

    if (typeof part === "string")
    {
      //noinspection JSValidateTypes
      part = parts.indexOf(part);
    }

    if (column < 0 || column >= entities[entityName].columns.length || part >= parts.length)
    {
      return undefined;
    }

    return (part >= 0) ? entities[entityName].columns[column][part] : entities[entityName].columns[column];
  }



  // ===================================================================================================================
  // helper functions
  // ===================================================================================================================
  /**
   * trigger an event on document and passes all arguments to it.
   * @param {String} event Event name + [... optional arguments]
   * @private
   */
  function _trigger(event)
  {
    //noinspection JSValidateTypes
    var $document = $(document);
    $document.trigger.apply($document, arguments);
  }


  /**
   * checks option object and throws errors, if required.
   * @private
   */
  function _checkOptions()
  {
    if (!options.name || options.name === '')
    {
      throw new Error("DBError: no database name. set with $.db.setOptions(...)");
    }
    if (!options.displayName || options.displayName === '')
    {
      throw new Error("DBError: no database displayName. set with $.db.setOptions(...)");
    }
    if (!options.databaseSize || options.databaseSize <= 0)
    {
      throw new Error("DBError: no database size. set with $.db.setOptions(...)");
    }
  }


  // ===================================================================================================================
  // jQuery/af helper
  // ===================================================================================================================
  //noinspection JSAccessibilityCheck
  if (typeof $.is === "undefined")
  {
    /**
     * tests an object if it has a specified type.
     * @param {String} type Class name [String|Number|Boolean|Date|Array|Object|Function|RegExp] OR undefined OR null
     * @param {*} obj
     * @return {Boolean} TRUE if type matches the class of obj
     */
    $.is = function(type, obj)
    {
      var objClass = $.typeOf(obj);
      return objClass === type || objClass.toLowerCase() === type;
    }
  }

  //noinspection JSAccessibilityCheck,JSUnresolvedVariable
  if (typeof $.typeOf === "undefined")
  {
    /**
     * returns the type of an object.
     * @param {*} obj
     * @return {String} class name [String|Number|Boolean|Date|Array|Object|Function|RegExp] OR undefined OR null
     */
    $.typeOf = function(obj)
    {
      if (obj === undefined) { return "undefined"; }
      if (obj === null) { return "null"; }
      return Object.prototype.toString.call(obj).slice(8, -1);
    }
  }


})(af, window);
