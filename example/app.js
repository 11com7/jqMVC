var app = new $.mvc.app();

app.loadModels("todo");
app.loadControllers("todo");
//Routing by hash change
app.setViewType("text/html");
app.listenHashChange();


$.mvc.addRoute("/archived",function(d){
    console.log("Archive panel switch via hash change",arguments,d);
})

//Try routing to these in the chrome console
$.mvc.addRoute("/foo/bar",function(d){
    console.log("bar",arguments,d);
});

$.mvc.addRoute("/foo/foo",function(){
    console.log("foo",arguments);
});

$.mvc.addRoute("/foo",function(){
    alert("foo");
});

//We wait until app.ready is available to fetch the data, then we wire up the existing data in the templates
app.ready(function(){
    $.mvc.route("/todo");//Load the default todo route
});