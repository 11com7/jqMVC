"use strict";

/**
 * SqliteStorageAdapter - manages model data in a SQLite database.
 * @author dom <d.pesch@11com7.de>
 * @since 2012-09-30
 */
var SqliteStorageAdapter = (function($)
{
  var
    _protectedColumns = ['id', 'dt_create', 'dt_change']
    ;


  //noinspection FunctionWithInconsistentReturnsJS
  var SqliteStorageAdapter = function(){
    // scope-safe constructor
    if (this instanceof SqliteStorageAdapter)
    {
      this.dbQuery = null;
    }
    else
    {
      return new SqliteStorageAdapter();
    }
  };

  SqliteStorageAdapter.prototype =
  {
    constructor : SqliteStorageAdapter,

    // ===================================================================================================================
    // save()
    // ===================================================================================================================
    /**
     * <p>Saves the object in database.</p>
     * <p>New objects (id == 0) will be inserted, existing (id > 0) will be updated.
     * This method gets the column names via $.db.getColumns() and fetch - only - this keys
     * from obj.
     * </p>
     *
     * <b> __sleep() method</b>
     * <p>Support a __sleep() method in model object, which will be called before passing the object to callback.
     * <pre><code>
     *  var Model = new $.mvc.model.extend("model",
     *  {
     *    // ...
     *
     *    // this method will be called automatically before getting the save values
     *    __sleep = function()
     *    {
     *      var objCopy = $.extend({}, this);
     *
     *      // do something "magic"
     *
     *      return objCopy;
     *    }
     *  }</code></pre>
     * </p>
     *
     * @param {$.mvc.modelDb} obj
     * @param {function} [callback]
     * @requires $.db
     * @throws Error  
     */
    save : function(obj, callback)
    {
      try
      {
        var db,
          tableName = obj.getTableName(),
          sql = "",
          columns,
          values,
          id = Math.max(0, obj.id || 0),
          isNew = (0 === id),
          self = this
          ;

        db = $.db.open();

        _checkTableName(tableName);
        columns = _getWriteColumns(tableName);
        sql = this._savePrepareSql(tableName, columns, isNew);
        values = this._savePrepareValues(obj, columns, id);

        db.transaction(
          // QUERY
          function(tx) {
            self._saveExecuteSql(tx, obj, sql, values, isNew);
          },
          // ERROR
          function(err) {
            throw $.db.SqlError(err, sql);
          },
          // SUCCESS
          function()
          {
            if (callback && $.isFunction(callback)) callback(obj);
          });
      }
      catch(err)
      {
        throw $.db.SqlError(err, sql);
      }
    },

    /**
     * (internal) Creates the sql save statement.
     * @param {String} tableName
     * @param {Array} columns
     * @param {Boolean} isNew
     * @return {String}
     * @protected
     */
    _savePrepareSql : function(tableName, columns, isNew)
    {
      var
        sql,
        placeholder = $.db.getColumnPlaceholder(tableName, columns);

      // INSERT statement
      if (isNew)
      {
        sql = "INSERT INTO " + tableName +
          " (" + columns.join(", ") + ")" +
          " VALUES (" + placeholder.join(", ") + ")"
        ;
      }
      // UPDATE statement
      else
      {
        var tuple = [];
        sql = "UPDATE " + tableName + " SET ";

        columns.forEach(function(col, t) { tuple.push(col + "=" + placeholder[t]); });

        sql += tuple.join(", ") + " WHERE id=?"
        ;
      }

      return sql;
    },

    /**
     * (internal) Get the values from obj. If defined and a function obj.__sleep() will be called.
     * @param {$.mvc.modelDb} obj
     * @param {Array} columns
     * @param {Number} id
     * @return {Array}
     * @protected
     */
    _savePrepareValues : function(obj, columns, id)
    {
      //noinspection JSUnresolvedFunction,JSUnresolvedVariable
      var
        values = $.values(obj, columns),
        tableName = obj.getTableName();


      if (obj.__sleep && $.isFunction(obj.__sleep)) {
        var newValues = obj.__sleep.call(obj);
        if ($.isObject(newValues)) {
          values = $.values(newValues, columns);
        }
      }

      values = $.db.prepareData(values);

      if (id != 0) {
        values.push(id);
      }

      return values;
    },

    /**
     * (internal) Executes the sql query for an object. The object id will be set for new objects.
     * @param {SQLTransaction} tx
     * @param {$.mvc.modelDb} obj
     * @param {String} sql
     * @param {Array} values
     * @param {Boolean} isNew
     * @private
     */
    _saveExecuteSql : function(tx, obj, sql, values, isNew)
    {
      //noinspection JSValidateTypes
      $.db.executeSql(tx, sql, values, function(tx, results)
      {
        if (isNew)
        {
          obj.id = results.insertId;
        }

        if (obj.__save && $.isFunction(obj.__save))
        {
          obj.__save.call(obj, tx);
        }
      });
    },


    // ===================================================================================================================
    // get
    // ===================================================================================================================
    /**
     * <p>Load a single object from the database and pass it (or null if not found) to callback(obj).</p>
     * <p>If the id isn't found, get() passes null to callback.</p>
     * <p><b>__wakeup() method</b>
     * get() supports a magic __wakeup() method in model. If this function could be found, it will called before passing the object to the callback function.
     * <code>this</code> refers to the loaded object!
     * <pre><code>
     *  var Model = new $.mvc.model.extend("model",
     *  {
     *    // ...
     *
     *    // this method will be called before the loaded object will be passed to callback()
     *    __wakeup : function()
     *    {
     *      // do something with "this"
     *
     *      return this;
     *    }
     *
     *    // ...
     *  }</code></pre>
     * </p>
     *
     * @param {Number} id
     * @param {function|undefined} [callback]
     * @param {jq.mvc.modelDb} obj
     * @requires $.db
     * @throws Error
     */
    get : function(id, callback, obj)
    {
      var
        db,
        tableName = obj.getTableName(),
        sql = "",
        columns,
        self = this
        ;


      try
      {
        db = $.db.open();

        _checkTableName(tableName);
        columns = $.db.getColumns(tableName);

        sql = "SELECT " + columns.join(", ") + " FROM " + tableName +
          " WHERE id=?";


        db.transaction(function(tx)
          {
            $.db.executeSql(tx, sql, [id], function(tx, results)
            {
              var el = null;

              if (results.rows.length > 0)
              {
                el = $.extend({}, obj, results.rows.item(0));

                self._autoConvertDates.call(self, el, tableName, columns);

                if (el.__wakeup && $.isFunction(el.__wakeup))
                {
                  el = el.__wakeup.call(el);
                }
              }

              return (callback && $.isFunction(callback)) ? callback(el) : el;
            });
          },
          // ERROR
          function(err)
          {
            throw $.db.SqlError(err, sql);
          });
      }
      catch(err)
      {
        throw $.db.SqlError(err, sql);
      }
    },


    // ===================================================================================================================
    // getAll
    // ===================================================================================================================
    /**
     * Returns all elements as array with model objects. Empty tables result in an empty array.
     * @param {String} type model name
     * @param {function} [callback]
     * @param {jq.mvc.modelDb} obj empty model object
     */
    getAll:function(type, callback, obj){
      this.search(obj, { filter: [] }, callback);
    },


    // ===================================================================================================================
    // remove
    // ===================================================================================================================
    /**
     * <p>Removes object from database.</p>
     * <p>The callback function will only been called, if the element was "really" deleted in the database.</p>
     * <p>Non existing elements won't call the callback nor trigger the remove event!</p>
     *
     * @param {$.mvc.modelDb} obj empty model object
     * @param {function} [callback]
     * @event modelName:remove will only be fired if object was really deleted in the database
     */
    remove:function(obj, callback){
      var
        db,
        tableName = obj.getTableName(),
        sql = ""
        ;

      try
      {
        db = $.db.open();
        _checkTableName(tableName);

        sql = "DELETE FROM " + tableName + " WHERE id = ?";

        db.transaction(function(tx)
        {
          $.db.executeSql(tx, sql, [obj.id], function(tx, results)
          {
            if (results.rowsAffected)
            {
              $(document).trigger(obj.modelName + ":remove", obj.id);
              if (callback && $.isFunction(callback)) { callback(obj) }
            }
          });
        },
        // ERROR
        function(err)
        {
          throw $.db.SqlError(err, sql);
        });
      }
      catch (err)
      {
        throw $.db.SqlError(err, sql);
      }
    },


    // ===================================================================================================================
    // search
    // ===================================================================================================================
    search:function(obj, search, callback, errorCallback)
    {
      var
        query = this._prepareDbQuery(obj),
        self = this;

      try
      {
        if ($.isArray(search)) { search = { filter: search }; }
        query.search(search, returnObjects, errorCallback);
      }
      catch(err)
      {
        throw $.db.SqlError(err, query.getSql());
      }


      function returnObjects(tx, results)
      {
        if (callback && $.isFunction(callback))
        {
          var
            all = [],
            tableName = obj.getTableName(),
            columns = query.getSearchColumns(search),
            hasWakeUp = (obj && obj.__wakeup && $.isFunction(obj.__wakeup));

          for (var t=0; t < results.rows.length; t++)
          {
            var el = $.extend({}, obj, results.rows.item(t));

            self._autoConvertDates.call(self, el, tableName, columns);

            all.push(hasWakeUp ? el.__wakeup.call(el) : el);
          }

          callback(all);
        }
      }

    },


    // ===================================================================================================================
    // helper
    // ===================================================================================================================
    /**
     * Creates or return the dbQuery obect.
     * @return {$.DbQuery}
     * @private
     */
    _prepareDbQuery : function(obj)
    {
      if (!$.DbQuery) { throw new Error("$.DbQuery is missing! Please load class.db_query.js."); }

      if (!this.dbQuery || !this.dbQuery instanceof $.DbQuery)
      {
        this.dbQuery = new $.DbQuery(obj.getTableName(), {db: $.db});
      }

      return this.dbQuery;
    },


    /**
     * (internal) Converts DATE columns to JS date objects, if they are unequal 0 or NULL.
     * @param {jq.mvc.modelDb} obj
     * @param {String} tableName
     * @param {Array.<String>} columns
     */
    _autoConvertDates : function(obj, tableName, columns)
    {
      columns.forEach(function(col)
      {
        if ($.db.columnExists(tableName, col) && $.db.isDateColumn(tableName, col) && obj.hasOwnProperty(col) && obj[col] !== 0 && obj[col] !== null)
        {
          var oldVal = obj[col];

          obj[col] = $.db.db2date(obj[col]);
        }
      });
    }

    // END of class
  };





  // ===================================================================================================================
  // helper
  // ===================================================================================================================
  function _checkTableName(nameOrObj)
  {
    var tableName = ($.isObject(nameOrObj)) ? nameOrObj.getTableName() : nameOrObj;
    if (!$.db.tableExists(tableName))
    {
      throw new Error("table '" + tableName + "' not defined in $.db");
    }
  }


  function _getWriteColumns(columnsOrTableName)
  {
    /** @type {Array} columns */
    var columns = ($.isArray(columnsOrTableName)) ? columnsOrTableName : $.db.getColumns(columnsOrTableName);
    return columns.filter(function(el) { return (_protectedColumns.indexOf(el) === -1); } );
  }



  // ===================================================================================================================
  // "global" methods (export via prototype or $.)
  // ===================================================================================================================
  if (!String.prototype.repeat)
  {
    /**
     * @param {Number} count repeat count times
     * @param {String} [delimiter] delimiter between repeated strings
     * @return {String}
     */
    String.prototype.repeat = function (count, delimiter)
    {
      var
        repeat = this + (delimiter || ''),
        back = new Array(isNaN(count) ? 1 : ++count).join(repeat);

      return !delimiter ? back : back.substr(0, back.length - delimiter.length);
    };
  }

  if (!$.values)
  {
    /**
     * Return some or all values from obj as (real) array.
     * @param {Object} obj
     * @param {Array}keys
     * @return {Array}
     */
    $.values = function(obj, keys)
    {
      var ret = [];
      keys = keys || Object.keys(obj);

      if (obj !== null && $.isArray(keys))
      {
        keys.map(function(el) { if (obj.hasOwnProperty(el))  { ret.push(obj[el]); } });
      }

      return ret;
    }
  }

  return SqliteStorageAdapter;
})(jq);
