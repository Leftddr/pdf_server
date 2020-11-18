var express = require('express');
var mongoose = require('mongoose');
var app = express();
var url = 'mongodb+srv://crossbell:root@2j-cluster.qzdkf.gcp.mongodb.net/2j-Cluster?retryWrites=true&w=majority';

mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);
mongoose.set('useUnifiedTopology', true);
mongoose.connect(url);
var db = mongoose.connection;

db.once('open', function(){
  console.log('DB Connected');
});

db.on('error', function(err){
  console.log('DB Error Detected : ', err);
});

app.set('view engine', 'ejs');
app.use(express.static(__dirname+'/public'));

var port = 56423;
app.listen(port, function(){
  console.log('Sever is Running on : http://localhost:'+port);
});
