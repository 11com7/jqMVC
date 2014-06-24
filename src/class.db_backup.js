//noinspection JSCheckFunctionSignatures
/**
 * DbBackup - Backup class for sql databases.
 * Copyright 2014 11com7, Bornheim, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2014-06-23
 */
(/**
 * @param {af} $
 * @param {window} window
 * @param {undefined} [undefined]
 */
  function($, window, undefined)
  {
    'use strict';

    // ===================================================================================================================
    // class $.DbBackup
    // ===================================================================================================================
    //noinspection FunctionWithInconsistentReturnsJS,JSValidateJSDoc
    /**
     *
     * @param opts
     * @returns {af.DbBackup}
     * @constructor
     * @this af.DbBackup
     */
    $.DbBackup = function(opts)
    {
      if (!(this instanceof $.DbBackup)) { return new $.DbBackup(opts); }



      /**
       * internal options.
       * @type {Object}
       */
      this._options = $.extend({}, $.DbBackup.defaultOptions, opts);

      this._$db = this._options.$db || $.db;

    };

    // --------------------------------------------------------------------------------
    // prototype
    // --------------------------------------------------------------------------------
    /**
     * @this af.DbBackup
     */
    $.DbBackup.prototype =
    {
      constructor : $.DbBackup,

      defaultOptions :
      {
        $db : null
      },


      /**
       * Dumps the database (structure and/or data).
       * @param {function(Object|String|*)} [successCallback] (function) will be called after the data will be dumped;
       *                                                      the data will be formatted with the given formatter
       *                                                      (no function) only the structure will be returned
       * @param {Object} [opts]
       * @param {String} [opts.formatter='json']  a formatter (from $.DbBackup.prototype.formatter[])
       * @returns {*|undefined}
       */
      dump : function(successCallback, opts)
      {
        opts = $.isObject(opts) ? opts : {};

        var
          self = this,
          dump = new $.DbBackup.Data(),
          formatter = this.formatter.json;

        //
        if (!!opts.formatter)
        {
          if ($.isFunction(this.formatter[opts.formatter]))
          {
            formatter = this.formatter[opts.formatter];
          }
          else
          {
            throw new TypeError('unknown formatter in opts.formatter: \'' + opts.formatter + '\'');
          }
        }

        // dump tables
        var tables = this._$db.getTables() || [];
        tables.forEach(function(table)
        {
          dump.sql.tables.push( self._$db.getSqlTable(table) );

          var cols = self._$db.getColumns(table);

          dump.tables[table] = cols.slice(0);
        });

        // dump triggers
        this._$db.getTriggers().forEach(function(view)
        {
          dump.sql.triggers.push( self._$db.getSqlTrigger(view) );
        });

        // dump indexes
        this._$db.getIndexes().forEach(function(view)
        {
          dump.sql.indexes.push( self._$db.getSqlIndex(view) );
        });

        // dump views
        this._$db.getViews().forEach(function(view)
        {
          dump.sql.views.push( self._$db.getSqlView(view) );
        });


        if (!$.isFunction(successCallback)) { return formatter(dump); }


        // asynchronous data dump
        _dumpNext(tables);


        function _dumpNext(tables)
        {
          if (!tables.length) { successCallback(formatter(dump)); return; }

          var table = tables.shift();
          window.setTimeout(function()
          {
            dump.data[table] = [];
            var cols = self._$db.getColumns(table);
            self._$db.executeSql(null, 'SELECT * FROM ' + table, [],
              // SUCCESS
              function(tx, /** SQLResultSet */ results)
              {
                for (var t = 0; t < results.rows.length; t++)
                {
                  var row = results.rows.item(t), dRow = [];

                  for (var tt = 0; tt < cols.length; tt++)
                  {
                    dRow.push( row[ cols[tt] ] );
                  }

                  dump.data[table].push( dRow );
                }

                _dumpNext(tables);
              },
              // ERROR
              function(tx, /** SQLError */ errors)
              {
                dump.errors[table] = '[' + errors.code + ']: ' + errors.message;
                _dumpNext(tables);
              }
            );
          }, 0);

        }
      },


      /**
       *
       * @param {String|Object} dump
       * @param {function} successCallback
       * @param {function(Number|String, String)} errorCallback
       * @param {Object} [opts]
       */
      restore : function(dump, successCallback, errorCallback, opts)
      {
        opts = $.isObject(opts) ? opts : {};


        // --------------------------------------------------------------------------------
        // prepare data
        // --------------------------------------------------------------------------------
        var data = this._prepareData(dump, _error);
        if (!data) { return; }


        // --------------------------------------------------------------------------------
        // check data
        // --------------------------------------------------------------------------------
        if (this._checkData(data, _error) !== true) { return; }


        // --------------------------------------------------------------------------------
        // restore data
        // --------------------------------------------------------------------------------
        var self = this, db = this._$db;
        db.getDatabase().transaction(
          function(tx)
          {
            var t;

            // create tables
            for (t = 0; t < data.sql.tables.length; t++)
            {
              db.executeSql(tx, data.sql.tables[t]);
            }

            // create triggers
            for (t = 0; t < data.sql.triggers.length; t++)
            {
              db.executeSql(tx, data.sql.triggers[t]);
            }

            // create indexs
            for (t = 0; t < data.sql.indexes.length; t++)
            {
              db.executeSql(tx, data.sql.indexes[t]);
            }

            // create views
            for (t = 0; t < data.sql.views.length; t++)
            {
              db.executeSql(tx, data.sql.views[t]);
            }

            // insert data
            if ($.isObject(data.data))
            {
              Object.keys(data.data).forEach(function(table)
              {
                var sql = 'INSERT OR IGNORE INTO ' + table
                  + ' (' + data.tables[table].join(',') + ')'
                  + ' VALUES (' + _repeat('?', data.tables[table].length, ',') + ')';

                for (var t = 0; t < data.data[table].length; t++)
                {
                  db.executeSql(tx, sql, data.data[table][t]);
                }
              });
            }

          },
          // TRANSACTION ERROR
          function(/** SQLError */ error)
          {
            _error(error.code, error.message);
          },
          // TRANSACTION SUCCESS
          function()
          {
            if ($.isFunction(successCallback)) { successCallback(); }
          }
        );


        // --------------------------------------------------------------------------------
        // helper
        // --------------------------------------------------------------------------------
        function _error(code, message)
        {
          if ($.isFunction(errorCallback))
          {
            errorCallback(code, message);
          }
          else
          {
            throw new Error('[' + code + ']: ' + message);
          }
        }

        function _repeat(str, cnt, separator)
        {
          var back = [], t;
          for (t = 0; t < cnt; t++)
          {
            back.push(str);
          }
          return back.join(separator);
        }
      },


      /**
       * (internal) returns dump as object (if possible).
       * @param {String|Object} dump  (Object) will be returned
       *                              (String) expects a JSON string which will be parsed
       * @param {function(Number|String, String)} errorCallback will be called on errors (parse OR TypeError)
       * @returns {$.DbBackup.Data|boolean}  (Object) dump as object
       *                            (boolean) false if the data ca
       * @private
       */
      _prepareData : function(dump, errorCallback)
      {
        if ($.isObject(dump))
        {
          return dump;
        }
        else if ('String' === _typeOf(dump))
        {
          try
          {
            return JSON.parse(dump);
          }
          catch (e)
          {
            errorCallback(e.name, e.message);
          }
        }
        else
        {
          errorCallback('TypeError', 'unsupported dump type \'' + _typeOf(dump) + '\'');
        }

        return false;
      },


      /**
       * @param {Object} data
       * @param {function(Number|String, String)} errorCallback will be called on errors
       * @returns {boolean}   TRUE if the essential internal structures exist; FALSE on error
       * @private
       */
      _checkData : function(data, errorCallback)
      {
        if (!$.isObject(data)) { errorCallback('TypeError', 'data has to be object'); return false; }
        if (!_checkObjectKeys(data, ['sql', 'tables'], 'data')) { return false; }
        if (!_checkObjectKeys(data.sql, ['tables', 'indexes', 'triggers', 'views'], 'data.sql')) { return false; }

        // should be ok
        return true;

        function _checkObjectKeys(obj, keys, errorPath)
        {
          return keys.every(function(key)
          {
            var keyExists = obj.hasOwnProperty(key) && $.isObject(obj[key]);
            if (!keyExists)
            {
              errorCallback('Error', 'missing key \'' + key + '\' in ' + errorPath);
            }
            return keyExists;
          });
        }
      },




      /**
       * @namespace
       */
      formatter :
      {
        raw : function(data)
        {
          return data
        },

        json : function(data)
        {
          return JSON.stringify( data );
        }
      },


      /**
       * Setter/getter for internal options.
       * @param {String|Object} [key]   (String) key getter (with no value)
       *                                (String) key setter (needs value)
       *                                (Object) object setter
       * @param {*} [value]
       * @returns {*|undefined} single option (key getter) or all options (getter) or undefined (setter).
       */
      options : function(key, value)
      {
        var opts = {};

        if (arguments.length === 0)
        {
          return this._options;
        }
        if (arguments.length === 1)
        {
          if ($.isObject(key))
          {
            opts = key;
          }
          else if (this._options.hasOwnProperty(key))
          {
            return this._options[key];
          }
          else
          {
            throw new TypeError('unknown or wrong option key: \'' + key + '\'');
          }
        }
        else
        {
          opts[key] = value;
        }

        var self = this;
        Object.keys(opts).forEach(function(key)
        {
          if (this.defaultOptions.hasOwnProperty(key))
          {
            self._options[key] = opts[key];
          }
        });
      }
    };


    // ===================================================================================================================
    // class $.DbBackup.Data
    // ===================================================================================================================
    //noinspection FunctionWithInconsistentReturnsJS,JSValidateJSDoc
    /**
     * @returns {af.DbBackup.Data}
     * @constructor
     */
    $.DbBackup.Data = function()
    {
      if (!(this instanceof $.DbBackup.Data)) { return new $.DbBackup.Data(); }

      /**
       * sql-structure-backup.
       * @type {{tables: Array, triggers: Array, indexes: Array, views: Array}}
       */
      this.sql =
      {
        tables : [],
        views : [],
        triggers : [],
        indexes : []
      };

      /**
       * { table1 : [col1, ..., colN], ... : ..., tableN : [...] }
       * @type {{}}
       */
      this.tables = {};

      /**
       * { table1 : [[data1], [...]], tableN : [...] }
       * @type {{}}
       */
      this.data = {};


      /**
       * { table1 : error1, ...:..., tableN : errorN }
       * only tables with errors will be added to this error object.
       * @type {Object.<String>}
       */
      this.errors = {};
    };


    /**
     * returns the type of an object.
     * @param {*} obj
     * @return {String} class name [String|Number|Boolean|Date|Array|Object|Function|RegExp] OR undefined OR null
     */
    function _typeOf(obj)
    {
      if (obj === undefined) { return 'undefined'; }
      if (obj === null) { return 'null'; }
      return Object.prototype.toString.call(obj).slice(8, -1);
    }
  })(af, window);
