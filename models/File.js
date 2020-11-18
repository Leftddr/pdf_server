var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var defaultStr = '';

// schema=======================================================================
var fileSchema = mongoose.Schema({
  originalFileName:{type:String},
  serverFileName:{type:String},
  size:{type:Number},
  uploadedBy:{type:mongoose.Schema.Types.ObjectId, ref:'user', required:true},
  postId:{type:mongoose.Schema.Types.ObjectId, ref:'post'},
  isDeleted:{type:Boolean, default:false},
  original:{type:String},
  translate:{type:String},
  isTranslated:{type:Boolean, default:false},
});

// instance methods 1===========================================================
fileSchema.methods.processDelete = function(){
  this.isDeleted = true;
  this.save();
};

// instance methods 2===========================================================
fileSchema.methods.translated = function(){
  this.isTranslated = true;
  this.save();
};


// instance methods 3===========================================================
fileSchema.methods.getFileStream = function(){
  var stream;
  var filePath = path.join(__dirname,'..','uploadedFiles',this.serverFileName);
  var fileExists = fs.existsSync(filePath);
  if(fileExists){
    stream = fs.createReadStream(filePath);
  }
  else {
    this.processDelete();
  }
  return stream;
};

// model & export===============================================================
var File = mongoose.model('file', fileSchema);

// model methods
File.createNewInstance = async function(file, uploadedBy, postId){
  return await File.create({
      originalFileName:file.originalname,
      serverFileName:file.filename,
      size:file.size,
      uploadedBy:uploadedBy,
      postId:postId,
      original:defaultStr,
      translate:defaultStr,
    });
};

module.exports = File;
