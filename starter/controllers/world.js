$.mvc.controller.create("hello", {
    views:["views/hello.js","views/world.js"], //These are the views we will use with the controller
    world:function(){
        //This is the action "world".  We will load the "world.js" view.
        //When loading views, you must reference the folder path and file name.
        $("#main").html($.template('views/world.js'));
    },
    init:function(){
        //Here we can run any initializing code for this controller/
    },
    default:function(){
        //Let's load the "hello.js" view as th default.
        $("#main").html($.template('views/hello.js'));
    },
});