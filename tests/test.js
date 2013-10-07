"use strict";

/**
 * @namespace jq
 * @class jq.MyTest
 * @property {Object} opt
 * @property {String} var3
 */
jq.MyTest = (function($){

  /**
   * @constructs
   * @name jq.MyTest
   * @param {Object} options
   */
  function MyClass(options)
  {
    if (!(this instanceof MyClass)) { return new MyClass(options); }


    (this._init = function()
    {
      this.opt = options;
      this.var2 = 5;
      this.var3 = "text";
      this._private = null;

      /**
       * @name jq.MyTest.staticFunction
       * @param b
       */
      this.staticFunction = function(b)
      {
        this.opt.b = b;
      }
    })();



  }

  MyClass.prototype =
  {
    /**
     * @ignore
     */
    constructor : MyClass,

    /**
     * @param z
     */
    test2 : function(z)
    {
      this.staticFunction(z);
      this.var2 = 2;
    },

    test3 : function()
    {
      this.var3 = "muuh";
      this._private = false;
    }
  };


  return MyClass;
}(jq));


(function($)
{
  "use strict";

  var b = new jq.MyTest({});
  b.staticFunction("a");

  b.test2("g");






}(jq));