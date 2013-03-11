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
 * @namespace jq
 */
(function(/** {jq} */ $, window, undefined)
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
      INTEGER : "STRFTIME('%s', ?)",
      TEXT : "STRFTIME('%Y-%m-%d %H:%M:%S', ?)", // <-- 'NOW' needs here an additional modifier ", LOCALTIME"
      NUMERIC : "STRFTIME('%J', ?)"
    },
    db2dateConverter = {
      INTEGER : function(seconds) { return seconds != 0 ? new Date(seconds*1000) : parseInt(seconds, 10);},
      // Safari needs some help (YYYY/MM/DD instead of YYYY-MM-DD)
      TEXT : function(dtstring) { return new Date(dtstring.replace(/-/g,"/")); },
      // Julian Date: unix epoch = 2440587.5 JD + sqlite assumes each day as "[...] exactly 86400 seconds [...]" (see http://www.sqlite.org/lang_datefunc.html)
      NUMERIC : function(juldate) { return new Date((juldate - 2440587.5) * 86400.0 * 1000); }
    }
    ;


  /**
   * @namespace jq.db
   */
  $.db = {};

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

  /**
   * Opens the database if necessary and returns the database object.
   * @return {Database|Boolean}
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
   * Returns TRUE if the table is added/defined; otherwise FALSE.
   * @param {String} tableName
   * @return {Boolean}
   */
  $.db.tableExists = function(tableName)
  {
    return (tableName && tables[tableName]);
  };

  /**
   * Returns TRUE if the column (and table) is added/defined; otherwise FALSE.
   * @param {String} tableName
   * @param {String} column
   * @return {Boolean}
   */
  $.db.columnExists = function(tableName, column)
  {
    return ($.db.tableExists(tableName) && column && _getColumnIndex(tableName, column) > -1);
  };


  /**
   * Checks an array with column names for a defined table and throws Error on non-defined columns.
   * @param {String} tableName
   * @param {Array} columns
   * @throws Error
   */
  $.db.checkColumns = function(tableName, columns)
  {
    if (!tableName) { throw new Error("missing tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }
    if (!columns || !$.isArray(columns)) { throw new Error("columns is '" + (typeof columns) + "' instead of an array"); }

    var lastCol=null;
    if (!columns.every(function(col) { lastCol = col; return $.db.columnExists(tableName, col); }))
    {
      throw new Error("column '" + lastCol + "' doesn't exists in '" + tableName + "'");
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
   */
  $.db.initDb = function(tx, forceReInit)
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
      _initDb(tx);
    }
  };

  function _initDb(tx)
  {
    if (!$.db.isOpen()) { throw new Error("database not opened"); }

    var sql = "",
      tables = $.db.getTables();


    if (!tx || !tx.executeSql)
    {
      database.transaction(function(tx)
      // init SQL transaction
      {
        _initDb(tx);
      },
      // ERRORS
      function(err)
      {
        throw new Error($.db.SqlError(err, sql));
      },
      // success
      function()
      {
        initialized = true;
      });
    }
    else
    {
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

      initialized = true;
    }
  }


  /**
   * Creates a table entity in the database.
   * @param {SQLTransaction} tx transaction object
   * @param {String} name table name
   */
  $.db.createTable = function(tx, name)
  {
    var sql;

    if (!!options.dropOnInit)
    {
      sql = $.template(SQL_DROP_TABLE, {'table' : name});
      $.db.executeSql(tx, sql);
    }

    sql = $.template(SQL_CREATE_TABLE, {'table' : name, 'fields' : _getSqlTableColumns(name), 'constraints' : _getSqlTableConstraints(name) });
    $.db.executeSql(tx, sql);
  };

  /**
   * Creates a named trigger in the database.
   * @param {SQLTransaction} tx transaction object
   * @param {String} trigger trigger name
   */
  $.db.createTrigger = function(tx, trigger)
  {
    var sql;

    if (!!options.dropOnInit)
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
   */
  $.db.createIndex = function(tx, index)
  {
    var sql;

    if (!!options.dropOnInit)
    {
      sql = $.template(SQL_DROP_INDEX, {'index' : index});
      $.db.executeSql(tx, sql);
    }

    sql = $.template(SQL_CREATE_INDEX, {'name' : index, 'unique' : indexes[index].unique, 'table' : indexes[index].table, 'fields' : indexes[index].columns.join(", ") });
    $.db.executeSql(tx, sql);
  };



  /**
   * Returns sql string with column definition statement.
   * @param tableName
   * @return {String}
   * @private
   */
  function _getSqlTableColumns(tableName)
  {
    var sqlColumns = [], columns = $.db.getColumns(tableName), t;

    for (t=0; t < columns.length; t++)
    {
      var columnData = _getColumnData(tableName, columns[t]);

      // TYPE: convert to sql type (needed for auto date magic handling)
      columnData[1] = $.db.getSqlColumnType(tableName, columns[t]);

      sqlColumns.push(columnData.join(" "));
    }

    return sqlColumns.join(", ");
  }

  /**
   * Returns sql string with table constraints definitions.
   * @param tableName
   * @return {String}
   * @private
   */
  function _getSqlTableConstraints(tableName)
  {
    return (tables[tableName].constraints && tables[tableName].constraints.length > 0) ? ", " + tables[tableName].constraints.join(", ") : '';
  }


  // ===================================================================================================================
  // SQL EXECUTE
  // ===================================================================================================================
  /**
   * Executes a sql statement with some auto enhancements (THIS FUNCTION SHOULD BE USED FOR ALL DATABASE EXECUTIONS!).
   * - auto transaction creation
   * - auto debugging
   * - auto store last sql statement (for errors)
   *
   * @param {?SQLTransaction} tx transaction object OR undefined for auto transaction
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
    if (options.debug) { $.db.dbg(sql, data); }
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
   */
  $.db.insertMultiRows = function(tableName, columns, rows, tx, readyCallback, errorCallback)
  {
    // start transaction if necessary
    if (typeof tx !== "object")
    {
      $.db.getDatabase().transaction(function(tx)
      {
        $.db.insertMultiRows(tableName, columns, rows, tx, readyCallback, errorCallback);
      });
      return;
    }

    if (!tableName) { throw new Error("missing or empty tableName"); }
    if (!$.db.tableExists(tableName)) { throw new Error("tableName '" + tableName + "' isn't added/defined."); }

    $.db.checkColumns(tableName, columns);

    readyCallback = $.isFunction(readyCallback) ? readyCallback : undefined;
    errorCallback = $.isFunction(errorCallback) ? errorCallback : undefined;

    var sql = $.db.createSqlInsertMultiRows(tableName, columns, rows);
    var values = [];

    for (var t = 0; t < rows.length; t++)
    {
      var row = $.db.prepareData(rows[t]);
      for (var tt = 0; tt < row.length; tt++)
      {
        values.push(row[tt]);
      }
    }

    //noinspection JSValidateTypes
    $.db.executeSql(tx, sql, values, readyCallback, errorCallback);
  };

  /**
   *
   * @param {String} tableName
   * @param {Array} columns
   * @param {Array} rows has to be an array with data arrays [[colData1, ..., colDataN], [...]]
   * @return {String}
   */
  $.db.createSqlInsertMultiRows = function(tableName, columns, rows)
  {
    if (!rows || !rows.length || rows.length < 1) { return ""; }

    var sql = "INSERT INTO " + tableName + "(" + columns.join(',') + ") ";


    // first row as select
    var asTmp = [], placeholders = [], placeholder;
    for (var t=0; t < columns.length; t++)
    {
      asTmp.push("? as " + columns[t]);
      placeholders.push("?");
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
    if (!tx || !tx.executeSql || typeof tx === "undefined")
    {
      $.db.getDatabase().transaction(function(tx)
      {
        $.db.dropDatabase(tx);
      },
      function(error)
      {
        throw new Error($.db.SqlError(error));
      });

      return;
    }


    /** @type {SQLTransaction} tx */
    $.db.executeSql(tx, "SELECT type,name FROM sqlite_master", [],
      // SUCCESS
      function(tx, results)
      {
        // ignore this entities
        var ignoreNames =
        {
          "__WebKitDatabaseInfoTable__" : true,
          "sqlite_autoindex___WebKitDatabaseInfoTable___1" : true,
          "sqlite_sequence" : true
        };

        // delete all table, trigger, indexes, views (ignore the entities above)
        for (var t = 0; t < results.rows.length; t++)
        {
          var name = results.rows.item(t).name;
          if (!ignoreNames.hasOwnProperty(name))
          {
            $.db.executeSql(tx, "DROP " + results.rows.item(t).type + " IF EXISTS " + name);
          }
        }

        $.db.executeSql(tx, "DELETE FROM sqlite_sequence", [], readyCallback); // delete all auto ids
      },
      // ERROR
      function(tx, error)
      {
        throw new Error($.db.SqlError(error));
      }
    );

  };


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
      return data.map($.db.prepareData );
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

  /**
   * @param {String} colType has to be UPPERCASE
   * @return {Boolean} TRUE if colType contains DATE or TIME
   * @private
   */
  function _isDateType(colType)
  {
    return (colType.indexOf("DATE") > -1 || colType.indexOf("TIME") > 0)
  }


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
   * @param {String} tableName !must exist!
   * @param {String} columnName
   * @return {Number}
   * @private
   */
  function _getColumnIndex(tableName, columnName)
  {
    var columns = _getColumnNames(tableName);
    //noinspection JSValidateTypes
    return (columns.length) ? columns.indexOf(columnName) : -1;
  }


  /**
   * Returns an array with column names for a table.
   * @param tableName !must exist!
   * @return {Array}
   * @private
   */
  function _getColumnNames(tableName)
  {
    var columns = [];
    for (var t=0; t < tables[tableName].columns.length; t++)
    {
      columns.push(_getColumnData(tableName, t, 0));
    }

    return columns;
  }


  /**
   * Returns column definition (or a part of it) for an existing table.column combination.
   * @param {String} tableName !must exist!
   * @param {String|Number} column
   * @param {String|Number} [part] name|type|constraints or 0|1|2
   * @return {Array|String|undefined} (Array) complete column definition (= Array(3));
   *                                  (String) part of column definition;
   *                                  (undefined) unknown/not existing column or part
   * @private
   */
  function _getColumnData(tableName, column, part)
  {
    var parts = ["name", "type", "constraints"];

    if (typeof column === "string")
    {
      column = _getColumnIndex(tableName, column);
    }

    if (typeof part === "string")
    {
      //noinspection JSValidateTypes
      part = parts.indexOf(part);
    }

    if (column < 0 || column >= tables[tableName].columns.length || part >= parts.length)
    {
      return undefined;
    }

    return (part >= 0) ? tables[tableName].columns[column][part] : tables[tableName].columns[column];
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
  // jQuery/jq helper
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

})(jq, window);
