

var app = new $.mvc.app();
app.loadControllers(["hello"]); //You can pass in array or a string.  You do not need to reference the .js extension.
//app.setBaseDir("starter");
//Now let's run code on app.ready and load the default action for the hello controller.
app.ready(function(){
    $.mvc.route("/hello");
});