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
   * SqlClause - wraps "complex" sql clause strings in an object.
   * @param {String} sqlClause
   * @constructor
   */
  $.SqlClause = function(sqlClause)
  {
    this.set(sqlClause || "");
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
    get : $.SqlClause.prototype.toString
  };


  /**
   * DbQuery - this class helps to create sql select statements with arrays.
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

    this._table = tableName;
    this._db = (options && options.db) ? options.db : $.db;
    this._callbackFilterElement = undefined;
  };


  //noinspection FunctionWithInconsistentReturnsJS
  $.DbQuery.prototype =
  {
    SQL_OPERATORS : flipToObject(['<', '>', '=', '>=', '<=', '<>', '!=',
                    'BETWEEN', 'IN', 'NOT IN', 'LIKE', 'NOT LIKE',
                    'REGEXP', 'RLIKE', 'NOT REGEXP',
                    'ISNULL', 'NOT ISNULL',
                    'EXISTS', 'NOT EXISTS', 'ALL', 'ANY']),

    SQL_OPERATORS_ARRAY : flipToObject(['BETWEEN', 'IN', 'NOT IN']),

    SQL_OPERATORS_LOGIC : flipToObject(['AND', 'OR', 'XOR', 'NOT']),


    /**
     * Builds and runs a sql query from search array and method parameter.
     * @param {Array} search  filter array
     * @param {Array|null} [columnList] (array) with existing columns, or $.SqlClause-Objects |
     *                                  (null) for all columns
     * @param {Number|Array|null} [limit=0]
     * @param {String} [logicOperator='AND']
     * @param {String|Array} [orderBy='']
     */
    search : function(search, columnList, limit, logicOperator, orderBy)
    {
      if (!$.isArray(search) || search.length < 1)
      {
        throw new Error("empty or no search array");
      }

      var
        returnSingle = true,
        returnColumns = this._searchPrepareReturnColumns(columnList),
        sqlColumns = "",
        sqlWhere = ""
        ;

      if (!returnColumns)  { throw new Error("no return columns"); }

      returnSingle = this._searchIsSingleReturn(returnColumns);

      sqlColumns = this._buildSqlColumns(returnColumns);

      sqlWhere = this._buildSqlFromFilterArray(search, "AND");


    },

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
              throw new Error("unknown column in columnList[" + t + "]: ' " + columnList[t] + "'" );
            }

            returnColumns.push(columnList[t]);
          }
          else if ($.isObject(columnList[t]))
          {
            returnColumns.push(columnList[t]);
          }
          else
          {
            throw new Error("unaccepted column type columnList[" + t + "] (" + (typeof columnList[t]) + ")" );
          }
        }

        return returnColumns;
      }
    },

    _searchIsSingleReturn : function(columnList)
    {
      return columnList.length == 1;
    },

    _buildSqlColumns : function(columnList)
    {
      var columns = [];

      columnList.map(function(column)
      {
        columns.push( (column instanceof $.SqlClause) ? column.get() : column );
      });

      return columns.join(", ");
    },


    /**
     *
     * @param {Array} search
     * @param {String} [logicOperator]
     */
    count : function(search, logicOperator)
    {

    },

    /**
     * Deletes one or many rows from a table.
     * @param {Array} search
     * @param {Number|Array|null} [limit]
     * @param {String} [logicOperator]
     */
    deleteSearch : function(search, limit, logicOperator)
    {

    },

    setDb : function(db)
    {
      this._db = db;
    },

    getTableName : function()
    {
      return this._table;
    },



    _buildSqlQuery : function()
    {

    },


    /**
     * (internal) creates a sql string from a filter array.
     * @param {Array} search  search/filter array
     * @param {String} [logicOperator] default operator between filter array elements
     * @private
     */
    _buildSqlFromFilterArray : function (search, logicOperator)
    {
      if (!$.isArray(search)) { throw new Error("missing or wrong parameter search. got " + (typeof search) + " need Array"); }
      if (!search.length) { return ""; } // empty search == empty sql query

      logicOperator = (logicOperator && logicOperator.length) ? logicOperator.toUpperCase() : "AND";
      if (!this.SQL_OPERATORS_LOGIC[logicOperator])
      {
        throw new Error("unknown logicOperator '" + logicOperator + " (" + (typeof logicOperator) + "). accepts only: " + this.SQL_OPERATORS_LOGIC.join(', '));
      }

      var
        sql = "",
        openBracket = true   // if true, the logicOperator will be supressed
        ;

      // search[t] has to be:
      // - string clause: ['column', 'operator', 'value' | {SqlCLause}, ['logicOperator']]
      // - brackets:      ['(' | ')', ['logicOperator']] | '(' | ')'
      // - SqlClause:     [{SqlClause}, ['logicOperator']] | {SqlClause}
      for (var t=0; t < search.length; t++)
      {
        var
          entry = search[t],
          entryType = typeof entry;


        if (!entry) { throw new Error("missing search[" + t + "] (" + (typeof entry) + ")"); }


        if (!$.isArray(entry))
        {
          if (entry === "(" || entry === ")" || entry instanceof $.SqlClause)
          {
            entry = [entry];
          }
          else
          {
            throw new Error("search[" + t + "] (" + (typeof entry) + ") isn't an array");
          }
        }
        else
        {
          if (!entry[0])
          {
            throw new Error("search[" + t + "][0] fieldname (or bracket or SqlClause) doesn't exists");
          }
        }


        // handle brackets
        if (entry[0] === "(" || entry[0] === ")")
        {
          if (entry[0] === "(" && !openBracket)
          {
            sql += " " + this._getLogicOperator(entry[1], logicOperator);
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
        if (entryType === "string")
        {
          entry[1] = _prepareSearchOperator(entry[1]);
        }






      }


    },


    /**
     * (internal) Returns a sql string with a valid limit clause or an empty string.
     * @param {String|Array|null} limit
     * @return {String}
     * @private
     */
    _buildSqlLimit : function(limit)
    {
      if (limit == undefined || limit == '')  return '';

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
      if (orderBy == undefined || orderBy == '')  return '';

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


    _getLogicOperator : function(op1, op2)
    {
      return (op1 && this.SQL_OPERATORS_LOGIC[op1.toUpperCase()]) ? op1.toUpperCase() : op2;
    },

    _prepareColumnName : function(columnName)
    {
      if (!columnName || typeof columnName !== "string")
      {
        throw new Error("invalid or empty column name: '" + columnName + "' (" + (typeof columnName) + "). has to be non empty string!");
      }

      return columnName.trim().toLowerCase();
    },

    /**
     * (internal) helper for _buildSqlFromFilterArray() to prepare the operator.
     * @param {Array} entry the actual search row entry
     * @param {Number} opIndex index number of the operator in entry
     * @param {Number} searchIndex the actual search row (used for exception infos)
     * @private
     */
    _prepareSearchOperator : function(entry, opIndex, searchIndex)
    {
      if (!entry[opIndex] || entry[opIndex] == undefined)
      {
        throw new Error("missing or empty operator in search[" + searchIndex + "][" + opIndex + "]");
      }

      if (typeof entry[opIndex] !== "string")
      {
        throw new Error("wrong operator type (" + (typeof entry[opIndex]) + ") in search[" + searchIndex + "][" + opIndex + "]");
      }

      entry[opIndex] = entry[opIndex].trim().toUpperCase();

      if (!this.SQL_OPERATORS.hasOwnProperty(entry[opIndex]) &&
          !this.SQL_OPERATORS_ARRAY.hasOwnProperty(entry[opIndex])
         )
      {
        throw new Error("unknown operator '" + entry[opIndex] + "' in search[" + searchIndex + "][" + opIndex + "]");
      }
    },


    /**
     * (internal) helper for _buildSqlFromFilterArray() to prepare the operator.
     * @param {Array} entry the actual search row entry
     * @param {Number} valueIndex the index number for the value field in entry
     * @param {Number} opIndex index number of the operator in entry
     * @param {Number} searchIndex the actual search row (used for exception infos)
     * @private
     */
    _prepareSearchValue : function(entry, valueIndex, opIndex, searchIndex)
    {
      if (!entry.hasOwnProperty(valueIndex) || entry[valueIndex] == undefined)
      {
        throw new Error("missing or empty value in search[" + searchIndex + "][" + valueIndex + "]");
      }

      var value = entry[valueIndex];


      // special treatment for array operator with string values (which should be converted to arrays)
      if ()


      if (isString(value) === "string")
      {

      }
      else if (isNumeric(value) === "number")
      {
        // allowed value => nothing to do
      }
      else if (typeof value === "boolean")
      {
        value = parseInt(value, 10);
      }
      else if (value === null)
      {
        value = "NULL";
      }
      else if ($.isArray(value))
      {

      }
      else if (value instanceof $.SqlClause)
      {
        value = value.get();
      }
      else
      {
        throw new Error("unsupported value in search[" + searchIndex + "][" + valueIndex + "]: '" + value + "' (" + valueType + ")");
      }

    }








  };

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


  function isString(test)
  {
    return typeof test === "string";
  }

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