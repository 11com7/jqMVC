//noinspection JSCheckFunctionSignatures
/**
 * DbQuery - This class allows to create different queries with simple array structures.
 *
 * Copyright 2012 11com7, Bonn, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-11-01
 */
(function($, window, undefined)
{
  "use strict";

  /**
   * $.SqlClause - wraps sql clause strings with parameter values in an object and could be passed to $.DbQuery().
   * @param {String} sqlClause
   * @param {Array} [sqlValues] sql values for '?' parameter in the sqlClause
   * @constructor
   */
  $.SqlClause = function(sqlClause, sqlValues)
  {
    this._sqlClause = "";
    this._sqlValues = [];

    this.set(sqlClause || "");
    this.values(sqlValues || []);
  };

  $.SqlClause.prototype =
  {
    /**
     * Returns the sql clause as string.
     * @return {String} sql clause
     */
    toString : function()
    {
      return this._sqlClause;
    },

    /**
     * Sets the sql claus string.
     * @param {String} sqlClause
     */
    set : function(sqlClause)
    {
      if (typeof sqlClause !== "string") throw new Error("SqlClause accepts only strings");

      this._sqlClause = sqlClause;
    },

    /**
     * @inheritDoc
     */
    get : function()
    {
      return this.toString();
    },

    /**
     * @return {Boolean} TRUE if this SqlClause object has one or more sql values.
     */
    hasValues : function()
    {
      return (this._sqlValues.length > 0);
    },

    /**
     * accessor for internal values: no parameter = get values; with array as parameter = set values.
     * @param {Array} [newValues] set values if parameter is an array
     * @return {Array}
     */
    values : function(newValues)
    {
      if ($.isArray(newValues))
      {
        this._sqlValues = newValues;
      }

      return this._sqlValues;
    }
  };


  /**
   * DbQuery - this class helps to create sql select statements with arrays.
   *
   * Queries are build with a filter/search array:<pre>
   * Simple:
   *  ['a', '=', 1] => "WHERE a=?"; [1]
   *  ['b', 'between', "5,6"] => "WHERE b BETWEEN (?,?)"; [5, 6]
   *  ['b', 'between', [5,6]] => "WHERE b BETWEEN (?,?)"; [5, 6]
   *
   * With logic operators
   *  [['a', '=', 1], ['b', '!=', 1]] => "WHERE (a = ?) AND (b != ?)"; [1, 1]
   *  [['a', '=', 1], ['b', '!=', 1, "OR"]] => "WHERE (a = ?) OR (b != ?)"; [1, 1]
   *  or with logicOperator = "OR"
   *  [['a', '=', 1], ['b', '!=', 1]] => "WHERE (a = ?) OR (b != ?)"; [1, 1]
   *
   * With parenthesis
   * [['('], ['a', '=', 1], ['b', '!=', 1], [')'], ['c', 'IN', [6,7,8,9], "OR"]]
   * => WHERE ((a = ?) AND (b != ?)) OR (c IN (?, ?, ?, ?)); [1, 1, 6, 7, 8, 9]
   *
   * With $.SqlClause objects
   * ['z', 'IN', new $.SqlClause('SELECT id FROM foo WHERE a=? and b=?', [5, 6])]
   * => WHERE (z IN SELECT id FROM foo WHERE a=? and b=?); [5, 6]
   *
   * And a little bit more complex
   * [['y','not in',"5,6,7,8,9"], ['z', 'IN', new $.SqlClause('SELECT id FROM foo WHERE a=? and b=?', [42, 1337])]]
   * => (y NOT IN (?, ?, ?, ?, ?)) AND (z IN SELECT id FROM foo WHERE a=? and b=?); ["5", "6", "7", "8", "9", 42, 1337]
   * </pre>
   *
   * @param {String} tableName
   * @param {Object} [options]
   * @constructor
   */
  $.DbQuery = function(tableName, options)
  {
    if (!tableName || tableName == "" || typeof tableName !== "string")
    {
      throw new Error("parameter tableName is missing or empty");
    }

    /**
     * @type {String}
     * @private
     */
    this._table = tableName;

    /**
     * sqlite library object.
     * @type {$.db}
     * @private
     */
    this._db = (options && options.db) ? options.db : $.db;

    /**
     * JavaScript database object for W3C web sql database interface.
     * @type {Database}
     * @private
     */
    this._database = this._db.getDatabase();

    /**
     * callback function which will be called for every search filter element.
     * It has to return the complete filter entry[x].
     * @type {function|undefined}
     * @private
     */
    this._callbackFilterElement = undefined;

    /**
     * the last sql query, will be created by _buildSqlFromFilterArray().
     * @type {String}
     * @private
     */
    this._sql = '';

    /**
     * Array with a value for every ? which will be set in the sql query.
     * @type {Array}
     * @private
     */
    this._sqlValues = [];
  };


  //noinspection FunctionWithInconsistentReturnsJS,JSUnusedGlobalSymbols
  $.DbQuery.prototype =
  {
    SQL_OPERATORS : flipToObject(['<', '>', '=', '>=', '<=', '<>', '!=',
                    'BETWEEN', 'IN', 'NOT IN', 'LIKE', 'NOT LIKE',
                    'REGEXP', 'RLIKE', 'NOT REGEXP',
                    'ISNULL', 'NOT ISNULL',
                    'EXISTS', 'NOT EXISTS', 'ALL', 'ANY']),

    SQL_OPERATORS_ARRAY : flipToObject(['BETWEEN', 'NOT BETWEEN', 'IN', 'NOT IN']),

    SQL_OPERATORS_LOGIC : flipToObject(['AND', 'OR', 'XOR', 'NOT']),



    // ================================================================================================================
    // SEARCH
    // ================================================================================================================
    /**
     * Builds and runs a sql query from search array and method parameter.
     * @param {Object} search
     * @param {Array} search.filter  filter array (empty array returns all entries)
     * @param {Array|null} search.columns  (array) with existing columns, or $.SqlClause-Objects |
     *                                    (null) for all columns
     * @param {Number|Array|null} [search.limit=0]
     * @param {String} [search.operator='AND']
     * @param {String|Array} [search.order='']
     * @param {Function} successCallback
     * @param {Function} [errorCallback]
     */
    search : function(search, successCallback, errorCallback)
    {
      if (!$.isObject(search) || !search.filter) { throw new Error("Need search object:{filter, [columns], [limit], [operator], [order]}"); }

      //noinspection JSUnresolvedVariable
      var
        columns = search.columns || null,
        limit = search.limit || 0,
        operator = search.operator || undefined,
        order = search.order || '';

      this.prepareSearch(search);
      this.execute(successCallback, errorCallback);
    },


    /**
     * Builds and returns a sql query from search array and method parameter.
     * @param {Object} search
     * @param {Array} search.filter  filter array (empty array returns all entries)
     * @param {Array|null} search.columns  (array) with existing columns, or $.SqlClause-Objects |
     *                                    (null) for all columns
     * @param {Number|Array|null} [search.limit=0]
     * @param {String} [search.operator='AND']
     * @param {String|Array} [search.order='']
     * @return {String}
     */
    prepareSearch :function(search)
    {
      if (!search || !search.columns) { search.columns = null; }


      var
        returnColumns = this._searchPrepareReturnColumns(search.columns),
        sqlWhere
        ;

      if (!returnColumns)  { throw new Error("no return columns"); }

      sqlWhere = this._buildSqlFromFilterArray(search);

      this._sql = "SELECT " +
                  this._buildSqlColumns(returnColumns) +
                  " FROM " + this._table +
                  (sqlWhere ? " WHERE " + sqlWhere : "");

      //noinspection JSUnresolvedVariable
      if (search.orderBy)
      {
        //noinspection JSUnresolvedVariable
        this._sql += this._buildSqlOrderBy(search.orderBy);
      }

      //noinspection JSUnresolvedVariable
      if (search.limit)
      {
        //noinspection JSUnresolvedVariable
        this._sql += this._buildSqlLimit(search.limit);
      }

      return this._sql;
    },


    // ================================================================================================================
    // COUNT
    // ================================================================================================================
    /**
     *
     * @param {Object} search  search object
     * @param {Array} search.filter filter array (empty array returns all entries)
     * @param {String} [search.operator='AND']
     * @param {Function} errorCallback
     * @param {Function} [successCallback]
     */
    count : function(search, successCallback, errorCallback)
    {
      if (!$.isObject(search) || !search.filter) { throw new Error("Need search object:{filter, [operator]}"); }

      this.prepareCount(search);
      this.executeOneValue(successCallback, errorCallback);
    },

    /**
     * Builds and returns a COUNT sql query.
     * @param {Object} search  search object
     * @param {Array} search.filter filter array (empty array returns all entries)
     * @param {String} [search.operator='AND']
     * @return {String}
     */
    prepareCount : function(search)
    {
      var sqlWhere = this._buildSqlFromFilterArray(search);
      this._sql = "SELECT COUNT(*) FROM " + this._table;
      this._sql += (sqlWhere) ? " WHERE " + sqlWhere : "";

      return this._sql;
    },


    // ================================================================================================================
    // DELETE
    // ================================================================================================================
    /**
     * Deletes one or many rows from a table.
     * @param {Object} search  search object
     * @param {Array} search.filter filter array (empty array returns all entries)
     * @param {Number|Array|null} [search.limit]
     * @param {String} [search.operator='AND']
     * @param {Function} errorCallback
     * @param {Function} [successCallback]
     */
    deleteSearch : function(search, successCallback, errorCallback)
    {
      this.prepareDeleteSearch(search);
      this.execute(successCallback, errorCallback);
    },

    /**
     * Builds and return a DELETE sql query.
     * @param {Object} search  search object
     * @param {Array} search.filter filter array (empty array returns all entries)
     * @param {Number|Array|null} [search.limit]
     * @param {String} [search.operator='AND']
     * @return {String}
     */
    prepareDeleteSearch : function(search)
    {
      var sqlWhere = this._buildSqlFromFilterArray(search);

      this._sql = "DELETE FROM " + this._table;
      this._sql += (sqlWhere) ? " WHERE " + sqlWhere : "";

      if (search.hasOwnProperty('limit'))
      {
        //noinspection JSUnresolvedVariable
        this._sql += this._buildSqlLimit(search.limit);
      }

      return this._sql;
    },


    // ================================================================================================================
    // EXECUTE
    // ================================================================================================================
    /**
     * This function executes the actual SQL command.
     * They had to be build with one of the buildXyz()-methods.
     * @param {Function} successCallback
     * @param {Function} [errorCallback]
     */
    execute : function(successCallback, errorCallback)
    {
      var self = this;

      this._database.transaction(
        function(tx)
        {
          tx.executeSql(self.getSql(), self.getValues(), successCallback, errorCallback);
        }
      );
    },

    /**
     * This function executes the actual SQL command.
     * They had to be build with one of the buildXyz()-methods.
     * @param {Function} successCallback
     * @param {Function} [errorCallback]
     */
    executeOneValue : function(successCallback, errorCallback)
    {
      var self = this;

      this._database.transaction(
        function(tx)
        {
          tx.executeSql(self.getSql(), self.getValues(),
            function(tx, results)
            {
              var value = null;
              if (results.rows.length)
              {
                value = $.map(results.rows.item(0), function(val) { return val; });
                value = value[0][0];
              }

              if ($.isFunction(successCallback)) { successCallback(value); }
            },
            errorCallback)
        }
      );
    },

    /**
     * Execute the sql query in an opened transaction.
     * @param {SQLTransaction} tx
     * @param {Function} [successCallback]
     * @param {Function} [errorCallback]
     */
    executeInTransaction : function(tx, successCallback, errorCallback)
    {
      if (!tx || !tx instanceof SQLTransaction)
      {
        throw new Error("undefined or incompatible transaction tx (" + (typeof tx) + ")");
      }

      //noinspection JSValidateTypes
      tx.executeSql(this.getSql(), this.getValues(), successCallback, errorCallback);
    },


    // ================================================================================================================
    // accessors
    // ================================================================================================================
    /**
     * Set a database object (used by execute()).
     * @param {$.db} db
     */
    setDb : function(db)
    {
      this._db = db;
      this._database = db.getDatabase();
    },

    /**
     * Returns the table (or view) name.
     * @return {String}
     */
    getTableName : function()
    {
      return this._table;
    },

    /**
     * Returns the actual SQL query string (will be created by prepare[Search|Count|DeleteSearch|…]).
     * @return {String}
     */
    getSql : function()
    {
      return this._sql;
    },

    /**
     * Returns the values for the actual SQL query (if there are no elements, it returns an empty array).
     * @return {Array}
     */
    getValues : function()
    {
      return this._sqlValues;
    },

    /**
     * Returns the sql query as SqlClause object.
     * @return {$.SqlClause}
     */
    getSqlClause : function()
    {
      return new $.SqlClause(this.getSql(), this.getValues());
    },



    // ================================================================================================================
    // build sql helper
    // ================================================================================================================
    /**
     * (internal) build an sql string from a column array with column names (string) or $.SqlClause objects.
     * For $.SqlClause objects the string representation will be used.
     * @param {Array|Object} columns (numArray) columns OR
     *                               (Object) search.columns
     * @return {String}
     * @private
     */
    _buildSqlColumns : function(columns)
    {
      var returnColumns = [];

      if ($.isObject(columns) && columns.columns) { columns = columns.columns; }

      columns.map(function(column)
      {
        returnColumns.push( (column instanceof $.SqlClause) ? column.get() : column );
      });

      return returnColumns.join(", ");
    },


    /**
     * (internal) creates a sql string from a filter array.
     * @param {Object} search  search object
     * @param {Array} search.filter  search/filter array
     * @param {String} [search.operator] default operator between filter array elements, default value: AND
     * @private
     */
    _buildSqlFromFilterArray : function(search)
    {
      this._sqlValues = [];

      if (!$.isArray(search.filter)) { throw new Error("missing or wrong parameter search. got " + (typeof search) + " need Array"); }
      if (!search.filter.length) { return ""; } // empty search == empty WHERE
      var filter = search.filter;

      //noinspection JSUnresolvedVariable
      var operator = (search.operator && search.operator.length) ? search.operator.toUpperCase() : "AND";
      if (!this.SQL_OPERATORS_LOGIC[operator])
      {
        throw new Error("unknown search.operator '" + operator + " (" + (typeof operator) + "). accepts only: " + this.SQL_OPERATORS_LOGIC.join(', '));
      }

      if (!$.isArray(filter[0]))
      {
        filter = [filter];
      }

      var
        sql = "",
        openBracket = true   // if true, the logicOperator will be suppressed
        ;

      // search[t] has to be:
      // - string clause: ['column', 'operator', 'value' | {SqlClause}, ['logicOperator']]
      // - brackets:      ['(' | ')', ['logicOperator']] | '(' | ')'
      // - SqlClause:     [{SqlClause}, ['logicOperator']] | {SqlClause}
      for (var t=0; t < filter.length; t++)
      {
        var
          entry = filter[t],
          entryType = typeof entry;


        if (!entry) { throw new Error("missing search.filter[" + t + "] (" + (typeof entry) + ")"); }


        if (!$.isArray(entry))
        {
          if (entry === "(" || entry === ")" || entry instanceof $.SqlClause)
          {
            entry = [entry];
          }
          else
          {
            throw new Error("search.filter[" + t + "] (" + (typeof entry) + ") isn't an array");
          }
        }
        else
        {
          if (!entry[0])
          {
            throw new Error("search.filter[" + t + "][0] fieldname (or bracket or SqlClause) doesn't exists");
          }
        }


        // handle brackets
        if (entry[0] === "(" || entry[0] === ")")
        {
          if (entry[0] === "(" && !openBracket)
          {
            sql += " " + this._getLogicOperator(entry[1], operator);
          }
          else if (entry[0] === ")")
          {
            openBracket = false;
          }

          sql += entry[0];
          continue;
        }

        if (entryType === "string")
        {
          entry[0] = this._prepareColumnName(entry[0]);
        }

        // call filter callback
        if (this._callbackFilterElement && $.isFunction(this._callbackFilterElement))
        {
          entry = this._callbackFilterElement.call(this, entry);
          if (entry === false)  { continue; }
        }


        // handle string clauses
        if (isString(entry[0]))
        {
          if (entry[1])
          {
            entry[1] = this._prepareSearchOperator(entry, 1, 2, t);
          }


          if (typeof entry[2] !== "undefined")
          {
            entry[2] = this._prepareSearchValue(entry, 1, 2, t);
          }

          entry[3] = this._getLogicOperator(entry[3], operator);
          if (!this.SQL_OPERATORS_LOGIC.hasOwnProperty(entry[3]))
          {
            throw new Error("search.filter[" + t + "][3] unsupported logic operator '" + entry[3] + "'. has to be '" + this.SQL_OPERATORS_LOGIC.join("', '") + "'");
          }
        }

        if (!openBracket)
        {
          sql += " " + entry[3] + " ";
        }

        openBracket = false;

        if (isString(entry[0]))
        {
          entry.length = 3;
          sql += "(" + entry.join(" ") + ")";
        }
        else if (entry[0] instanceof $.SqlClause)
        {
          sql += "(" + entry[0].get() + ")";
          if (entry[0].hasValues())
          {
            this._sqlValues.push.apply(this._sqlValues, entry[0].values());
          }
        }
        else
        {
          throw new Error("search.filter[" + t + "][0] unsupported field type (" + (typeof entry[0]) + ")");
        }
      }

      return sql;
    },


    /**
     * (internal) Returns a sql string with a valid limit clause or an empty string.
     * @param {String|Array|null} limit
     * @return {String}
     * @private
     */
    _buildSqlLimit : function(limit)
    {
      if (!limit)  return '';

      var sqlLimit = '';

      if ($.isArray(limit) && 0 in limit && 1 in limit && limit[1] > 0)
      {
        sqlLimit += 'LIMIT ' + parseInt(limit[0], 10) + ', ' + parseInt(limit[1], 10);
      }
      else if (isNumeric(limit))
      {
        sqlLimit += 'LIMIT ' + parseInt(limit, 10);
      }

      return sqlLimit;
    },


    /**
     * (internal) Returns an empty or sql ORDER BY string.
     * @param {String|Array} orderBy
     * @return {String}
     * @private
     */
    _buildSqlOrderBy : function(orderBy)
    {
      if (!orderBy)  return '';

      var sqlOrderBy = [], allowedDir = {ASC : true, DESC : true};

      if ($.isArray(orderBy))
      {
        for (var t=0; t < orderBy.length; t++)
        {
          if (isString(orderBy[t]))
          {
            sqlOrderBy.push(orderBy[t]);
          }
          else if ($.isArray(orderBy[t]) && 0 in orderBy[t])
          {
            if (!orderBy[t][1] || !orderBy[t][1].toUpperCase() in allowedDir )
            {
              orderBy[t][1] = "ASC";
            }
            else
            {
              orderBy[t][1] = orderBy[t][1].toUpperCase();
            }

            sqlOrderBy.push(orderBy[t].join(" "));
          }
          else
          {
            // ignore!
          }
        }
      }
      else if (isString(orderBy))
      {
        sqlOrderBy[0] = orderBy;
      }

      return (sqlOrderBy.length) ? "ORDER BY " + sqlOrderBy.join(", ") : "";
    },


    /**
     * (internal) Checks if op1 is a valid operator and converts it to upper case; otherwise the default operator (defaultOp or AND) will be returned.
     * @param {String} op1
     * @param {String} [defaultOp]
     * @return {String}
     * @private
     */
    _getLogicOperator : function(op1, defaultOp)
    {
      defaultOp = defaultOp || "AND";
      return (op1 && this.SQL_OPERATORS_LOGIC[op1.toUpperCase()]) ? op1.toUpperCase() : defaultOp.toUpperCase();
    },


    /**
     * (internal) Trims and convert the column to lower case letters.
     * @param column
     * @return {String}
     * @private
     */
    _prepareColumnName : function(column)
    {
      if (!column || typeof column !== "string")
      {
        throw new Error("invalid or empty column name: '" + column + "' (" + (typeof column) + "). has to be non empty string!");
      }

      return column.trim().toLowerCase();
    },


    // ================================================================================================================
    // prepare helper
    // ================================================================================================================
    /**
     * (internal) Returns an array with existing column names or sqlClause objects.
     * @param {Array|null} [columnList]  array with fieldnames or SqlClaus objects
     * @return {Array}
     * @private
     * @throws Error for non existing column names or unknown types
     */
    _searchPrepareReturnColumns : function(columnList)
    {
      var returnColumns = [], columns = this._db.getColumns(this._table);

      if (!$.isArray(columnList) || columnList.length < 1)
      {
        return columns;
      }
      else if ($.isArray(columnList))
      {
        for (var t = 0; t < columnList.length; t++)
        {
          if (isString(columnList[t]))
          {
            if (columns.indexOf(columnList[t]) === -1)
            {
              throw new Error("unknown column in columns[" + t + "]: '" + columnList[t] + "'" );
            }

            returnColumns.push(columns[t]);
          }
          else if ($.isObject(columnList[t]))
          {
            returnColumns.push(columnList[t]);
          }
          else
          {
            throw new Error("unaccepted column type columns[" + t + "] (" + (typeof columnList[t]) + ")" );
          }
        }

        return returnColumns;
      }
    },

    /**
     * (internal) helper for _buildSqlFromFilterArray() to prepare the operator.
     *
     * @param {Array} entry the actual search row entry (will be changed if operator is ISNULL or NOT ISNULL)
     * @param {Number} opIndex index number of the operator in entry
     * @param {Number} valueIndex index number of the value field in entry
     * @param {Number} searchIndex the actual search row (used for exception informations)
     * @private
     */
    _prepareSearchOperator : function (entry, opIndex, valueIndex, searchIndex)
    {
      if (!entry[opIndex] || entry[opIndex] == undefined)
      {
        throw new Error("missing or empty operator in search[" + searchIndex + "][" + opIndex + "]");
      }

      if (typeof entry[opIndex] !== "string")
      {
        throw new Error("wrong operator type (" + (typeof entry[opIndex]) + ") in search[" + searchIndex + "][" + opIndex + "]");
      }

      var operator = entry[opIndex].trim().toUpperCase();

      if (!this.SQL_OPERATORS.hasOwnProperty(operator) &&
          !this.SQL_OPERATORS_ARRAY.hasOwnProperty(operator)
         )
      {
        throw new Error("unknown operator '" + operator + "' in search[" + searchIndex + "][" + opIndex + "]");
      }

      // special treatment for ISNULL or NOT ISNULL
      if (operator.indexOf("ISNULL") > -1)
      {
        entry[0] = new $.SqlClause(operator + "(" + entry[0] + ")");
        entry[valueIndex] = undefined;
        entry[3] = this._getLogicOperator(entry[valueIndex], '');

        operator = '';
      }

      return operator;
    },


    /**
     * (internal) helper for _buildSqlFromFilterArray() to prepare the operator.
     * @param {Array} entry the actual search row entry
     * @param {Number} valueIndex the index number for the value field in entry
     * @param {Number} opIndex index number of the operator in entry
     * @param {Number} searchIndex the actual search row (used for exception informations)
     * @private
     */
    _prepareSearchValue : function (entry, opIndex, valueIndex, searchIndex)
    {
      if (!entry.hasOwnProperty(""+valueIndex) || entry[valueIndex] == undefined)
      {
        throw new Error("missing or empty value in search[" + searchIndex + "][" + valueIndex + "]");
      }

      var value = entry[valueIndex], operator = entry[opIndex];


      // special treatment for array operator with string values (which should be converted to arrays)
      if (this.SQL_OPERATORS_ARRAY.hasOwnProperty(operator) && isString(value))
      {
        value = value.split(/\s*,\s*/);
      }


      if (isString(value) || isNumeric(value))
      {
        this._sqlValues.push(value);
        value = "?";
      }
      else if (typeof value === "boolean")
      {
        // convert bool to INT because sqlite don't know boolean values
        this._sqlValues.push(value + 0);
        value = "?";
      }
      else if (value === null)
      {
        this._sqlValues.push("NULL");
        value = "?";
      }
      else if ($.isArray(value))
      {
        if (!this.SQL_OPERATORS_ARRAY.hasOwnProperty(operator))
        {
          throw new Error("unsupported array for skalar sql operator in search[" + searchIndex + "][" + valueIndex + "]: [" + value.join(", ") + "] (" + (typeof value) + ")");
        }

        if (operator === "BETWEEN")
        {
          if (value.length !== 2)
          {
            throw new Error("unsupported array length for BETWEEN operator in search[" + searchIndex + "][" + valueIndex + "]: [" + value.join(", ") + "] (" + (typeof value) + ")");
          }

          this._sqlValues.push(value[0], value[1]);
          value = "? AND ?";
        }
        // array operators like IN, NOT IN
        else
        {
          var tmp = "(";
          for (var tt in value)
          {
            tmp+=(tt != 0 ? ", " : "") + "?";
            this._sqlValues.push(value[tt]);
          }
          value = tmp + ")";
        }
      }
      else if (value instanceof $.SqlClause)
      {
        if (value.hasValues())
        {
          this._sqlValues.push.apply(this._sqlValues, value.values());
        }

        value = value.get();
      }
      else
      {
        throw new Error("unsupported value in search[" + searchIndex + "][" + valueIndex + "]: '" + value + "' (" + (typeof value) + ")");
      }

      return value;
    }

  };

  //noinspection SpellCheckingInspection
  /**
   * Return TRUE if test is a numeric value.
   * @author Christian C. Salvadó
   * @see http://stackoverflow.com/a/1830844
   * @param {*} test
   * @return {Boolean}
   */
  function isNumeric(test)
  {
    return !isNaN(parseFloat(test)) && isFinite(test);
  }


  /**
   * Returns TRUE if test is a string.
   * @param {*} test
   * @return {Boolean}
   */
  function isString(test)
  {
    return typeof test === "string";
  }

  /**
   * Flips an array to an object by swapping the array values to object keys.
   * @example ['a', 'b', 'c'] => {a:0, b:1, c:2}
   * @param {Array} array
   * @return {Object}
   */
  function flipToObject(array)
  {
    var obj = {};
    if (!$.isArray(array))  { return obj; }

    for (var t in array)
    {
      if (array.hasOwnProperty(t))
      {
        obj[array[t]] = t;
      }
    }

    return obj;
  }

})(jq, window);