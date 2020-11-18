var express = require('express');
var router = express.Router('python-shell');
var multer = require('multer');
var uploadPath = 'default';
const {
  PythonShell
} = require('python-shell');
var Post = require('../models/Post');
var User = require('../models/User');
// var Comment = require('../models/Comment');
// 댓글은 필요 없으므로 Lock
var File = require('../models/File');
var util = require('../util');
var storage = multer.diskStorage({
  destination(req, file, cd) {
    cd(null, 'uploadedFiles/');
  },
  filename(req, file, cd) {
    uploadPath = Date.now() + '--' + file.originalname;
    cd(null, uploadPath);
  },
});
var upload = multer({
  storage: storage
});
var elastic = require('elasticsearch');
var client = new elastic.Client({
  host: 'localhost:9200',
})


// Index========================================================================
router.get('/', async function(req, res) {
  var page = Math.max(1, parseInt(req.query.page));
  var limit = Math.max(1, parseInt(req.query.limit));
  page = !isNaN(page) ? page : 1;
  limit = !isNaN(limit) ? limit : 10;

  var skip = (page - 1) * limit;
  var maxPage = 0;
  var searchQuery = await createSearchQuery(req.query);
  var posts = [];

  if (searchQuery) {
    var count = await Post.countDocuments(searchQuery);
    maxPage = Math.ceil(count / limit);
    posts = await Post.aggregate([{
        $match: searchQuery
      },
      {
        $lookup: {
          from: 'users',
          localField: 'author',
          foreignField: '_id',
          as: 'author'
        }
      },
      {
        $unwind: '$author'
      },
      {
        $sort: {
          createdAt: -1
        }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      },

      /* : 댓글관련 검색 기능이기에 Lock
      { $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'post',
          as: 'comments'
      } },
      */

      {
        $lookup: {
          from: 'files',
          localField: 'attachment',
          foreignField: '_id',
          as: 'attachment'
        }
      },
      {
        $unwind: {
          path: '$attachment',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          title: 1,
          author: {
            username: 1,
          },
          //views: 1, => 조회수 관련이므로 Lock
          numId: 1,
          attachment: {
            $cond: [{
              $and: ['$attachment', {
                $not: '$attachment.isDeleted'
              }]
            }, true, false]
          },
          createdAt: 1,
          //commentCount: { $size: '$comments'} => 댓글 관련 기능이므로 Lock
        }
      },
    ]).exec();
  }

  res.render('posts/index', {
    posts: posts,
    currentPage: page,
    maxPage: maxPage,
    limit: limit,
    searchType: req.query.searchType,
    searchText: req.query.searchText
  });
});

// New==========================================================================
router.get('/new', util.isLoggedin, function(req, res) {
  var post = req.flash('post')[0] || {};
  var errors = req.flash('errors')[0] || {};
  res.render('posts/new', {
    post: post,
    errors: errors
  });
});

// create=======================================================================
router.post('/', util.isLoggedin, upload.single('attachment'), async function(req, res) {
  var attachment = req.file ? await File.createNewInstance(req.file, req.user._id) : undefined;
  req.body.attachment = attachment;
  req.body.author = req.user._id;
  Post.create(req.body, function(err, post) {
    if (err) {
      req.flash('post', req.body);
      req.flash('errors', util.parseError(err));
      return res.redirect('/posts/new' + res.locals.getPostQueryString());
    }
    if (attachment) {
      attachment.postId = post._id;
      attachment.save();
    }
    res.redirect('/posts' + res.locals.getPostQueryString(false, {
      page: 1,
      searchText: ''
    }));
  });
});

// show=========================================================================
router.get('/:id', function(req, res) {

  Post.findOne({
      _id: req.params.id
    })
    .populate({
      path: 'author',
      select: 'username'
    })
    .populate({
      path: 'attachment',
      match: {
        isDeleted: false
      }
    })
    .exec(function(err, post) {
      if (err) return res.json(err);
      res.render('posts/show', {
        post: post
      });
    });
});
//var commentForm = req.flash('commentForm')[0] || { _id: null, form: {} };
//var commentError = req.flash('commentError')[0] || { _id:null, parentComment: null, errors:{} };
//댓글 기능은 필요없으로 Lock

/* => 댓글을 DB에서 다 긁어 온 다음 페이지에 보여주는 과정, 필요없으므로 Lock
  Promise.all([
    Post.findOne({_id:req.params.id}).populate({ path: 'author', select: 'username' }).populate({path:'attachment',match:{isDeleted:false}})
    Comment.find({post:req.params.id}).sort('createdAt').populate({ path: 'author', select: 'username' })
  ])
  .then(([post, comments]) => {
    post.views++;
    post.save();
    var commentTrees = util.convertToTrees(comments, '_id','parentComment','childComments');
    res.render('posts/show', { post:post, commentTrees:commentTrees, commentForm:commentForm, commentError:commentError});
  })
  .catch((err) => {
    return res.json(err);
  });
  */


// Trans========================================================================

router.get('/:id/trans', util.isLoggedin, checkPermission, async function(req, res) {
  var post = await Post.findOne({
    _id: req.params.id
  }).populate({
    path: 'author',
    select: 'username'
  }).populate({
    path: 'attachment',
    match: {
      isDeleted: false
    }
  });
  // DB에서 해당 게시글의 업로드 파일을 찾아서 접근
  var oriFileName = post.attachment.originalFileName;
  var servFileName = post.attachment.serverFileName;
  console.log(servFileName);

  if (!post.attachment.isTranslated) {
    // 업로드 된 파일의 번역여부가 false인 경우 새롭게 번역 & 업로드 진행
    console.log('\n\n\n\\First Translate Step\n\n\n');
    var filePath = '/mnt/c/CrossBell_Workspace/2j_worksapce_ver4/uploadedFiles/' + servFileName;
    var processing = true;
    var opt = {
      mode: "text",
      pythonPath: '',
      pythonOptions: ['-u'],
      scriptPath: '/mnt/c/CrossBell_Workspace/2j_worksapce_ver4/core',
      args: [filePath]
    };
    // 파이썬 번역 툴로 인자들을 넘겨주기 위한 변수선언 과정

    await PythonShell.run("textract_pdf.py", opt, (err, data) => {
      // 코어 파이썬 파일에 변수들을 넘겨주고 return값 recieve
      // 여기서 return값은 elastic에 업로드까지 마친 이후 동작되는 print('Complete') 함수에서 Complete
      if (err) {
        console.log(err);
      }
      console.log("python console data : ", data);
    });


    var from_py_original = await client.search({
      index: servFileName.substr(0, servFileName.length - 4)
    });
    //console.log(servFileName.substr(0, servFileName.length - 4));
    var from_py_translate = await client.search({
      index: 'translated_' + servFileName.substr(0, servFileName.length - 4)
    });
    //console.log('translated_' + servFileName.substr(0, servFileName.length - 4));
    // 파이썬에서 elastic에 올린 원본 & 번역본을 받아서 변수에 저장
    // elastic에 올라간 자료 제거 기능 추가 가능
    console.log("original : " + from_py_original);
    console.log("translate : " + from_py_translate);
    console.log('\n\n\n\output processing step\n\n\n');
    //console.log("data from elastic : ", from_py_original);
    //console.log("data from elastic : ", from_py_translate);
    //var from_py_translate = "참고문헌\n\nSaurabh Agarwal, Rahul Garg, Meeta S. Gupta 및 Jose E. Moreira. 대규모 병렬 시스템을위한 적응 형 증분 체크 포인트. 슈퍼 컴퓨팅에 관한 제 18 차 연례 국제 회의 회보, ICS ’04, 277–286 페이지, 미국 뉴욕, 뉴욕, 2004. ACM. [2] 안재형, 권 동업, 김영석, 모함마다 민 아지 다리, 이재원, 김장우. DCS : 빠르고 확장 가능한 장치 중심 서버 아키텍처. 마이크로 아키텍처에 관한 제 48 회 국제 심포지엄, MICRO-48. ACM, 2015. [3] Nadav Amit. 페이지 액세스 추적으로 tlb shootdown 알고리즘을 최적화합니다. 2017 년 Usenix 연례 기술 회의에 대한 USENIX 컨퍼런스, USENIX ATC ’17, 27–39 페이지, 미국 캘리포니아 주 버클리, 2017 년 USENIX Association. [4] Dmytro Apalkov, Alexey Khvalkovskiy, Steven Watts, Vladimir Nikitin, Xueti Tang, Daniel Lottis, Moon Kiseok, Xiao Luo, Eugene Chen, Adrian Ong, Alexander Driskill-Smith 및 Mohamad Krounbi. 스핀 전송 토크 자기 랜덤 액세스 메모리 (stt-mram). J. Emerg. Technol. 계산. Syst., 9 (2), 2013 년 5 월. [5] Jens Axboe. 유연한 I / O 테스터. https : // github. com / axboe / fio. [6] Arkaprava Basu, Jayneel Gandhi, Jichuan Chang, Mark D. Hill 및 Michael M. Swift. 대용량 메모리 서버를위한 효율적인 가상 메모리. 컴퓨터 아키텍처에 관한 제 40 회 연례 국제 심포지엄 회보, ISCA ’13, 237–248 페이지, 미국 뉴욕, 뉴욕, 2013. ACM. [7] Adrian M. Caulfeld, Todor I. Mollov, Louis Alex Eisner, Arup De, Joel Coburn 및 Steven Swanson. 빠른 솔리드 스테이트 디스크에 대한 안전한 사용자 공간 액세스를 제공합니다. 프로그래밍 언어 및 운영 체제에 대한 아키텍처 지원에 관한 제 17 회 국제 회의 회보에서 ASPLOS XVII. ACM, 2012. [8] 최재, 안재범, 김재범, 류세영, 한현진. 모바일 스마트 장치를위한 효율적인 스왑 지원을 제공하는 인 메모리 파일 시스템. IEEE Transactions on Consumer Electronics, 62 (3) : 275–282, 2016. [9] 최정식, 김지원, 한환수. 인 메모리 파일 시스템을위한 효율적인 메모리 매핑 파일 I / O. 스토리지 및 파일 시스템의 핫 토픽에 대한 9 차 USENIX 워크샵 (HotStorage 17). USENIX Association, 2017. [10] Austin T. Clements, M. Frans Kaashoek 및 Nicko- lai Zeldovich. rcu 균형 트리를 사용하는 확장 가능한 주소 공간. 프로그래밍 언어 및 운영 체제를위한 아키텍처 지원에 관한 제 17 차 국제 회의 회보, ASPLOS XVII, 199–210 페이지, 미국 뉴욕, 뉴욕, 2012 년. 컴퓨터 기계 협회.[11] Austin T. Clements, M. Frans Kaashoek 및 Nickolai Zeldovich. Radixvm : 멀티 스레드 애플리케이션을위한 확장 가능한 주소 공간. 컴퓨터 시스템에 관한 제 8 회 ACM 유럽 회의 회보, Eu-roSys ’13, 211–224 페이지, 미국 뉴욕, 뉴욕, 2013. 컴퓨터 기계 협회. [12] Jeremy Condit, Edmund B. Nightingale, Christopher Frost, Engin Ipek, Benjamin Lee, Doug Burger 및 Derrick Coetzee. ACM Persistent Memory의 진행 과정에서 바이트 주소 지정 가능을 통한 향상된 I / O. SIGOPS 22nd Symposium on Operating Systems Principles, SOSP ’09. ACM, 2009. [13] Subramanya R. Dulloor, Sanjay Kumar, Anil Keshavamurthy, Philip Lantz, Dheeraj Reddy, Rajesh Sankaran 및 Jeff Jackson. 영구 메모리 용 시스템 소프트웨어. 제 9 회 컴퓨터 시스템에 관한 유럽 회의 회보, EuroSys ’14. ACM, 2014. [14] Izzat El Hajj, Alexander Merritt, Gerd Zellweger, Dejan Milojicic, Reto Achermann, Paolo Faraboschi, Wen-mei Hwu, Timothy Roscoe, Karsten Schwan. Spacejmp : 여러 가상 주소 공간을 사용한 프로그래밍. 프로그래밍 언어 및 운영 체제를위한 아키텍처 지원에 관한 제 21 회 국제 회의 회보, ASPLOS ’16, 페이지 353–368, New York, NY, USA, 2016. ACM. R. Gioiosa, J.C. Sancho, S. Jiang 및 F. Petrini. 커널 수준의 투명한 증분 체크 포인트 : 병렬 컴퓨터의 내결함성을위한 기반. SC ’05 : 슈퍼 컴퓨팅에 관한 2005 ACM / IEEE 회의 절차, 2005 년 11 월 9-9 페이지 [16] R. Hagmann. Cedar 파일 시스템 다시 구현 로깅 및 그룹 커밋 사용 절차에서. 운영 체제 원칙에 관한 11 차 ACM 심포지엄, SOSP ’87, 155–162, 미국 뉴욕, 뉴욕, 1987. ACM. [17] Dave Hitz, James Lau 및 Michael Malcolm. NFS 파일 서버 어플라이언스를위한 파일 시스템 설계. 1994 년 USENIX Winter Technical Conference에 대한 USENIX Winter 1994 Technical Conference, WTEC'94, 19-19 페이지, Berkeley, CA, USA, 1994. USENIX Association. USENIX Association 2020 USENIX 연례 기술 컨퍼런스 13 [18] 인텔 메모리 지연 검사기. https : //software.intel.com/en-us/articles/ intelr-memory-latency-checker. [19] 인텔 OptaneTM DC 영구 메모리. https://www.intel.com/content/www/us/en/architecture-and-technology/optane-dc-persistent-memory.html. [20] 인텔 영구 메모리 프로그래밍. https : // pmem. io / pmdk /. 그리고 Micron의 [21] Intel ogy. 우리의 혁신 / 3d-xpoint- 기술. Technol- https://www.micron.com/about/ 3D XPointTM [22] Jonathan Corbet. 텐트 메모리, 2014. 610174 /. Persis 파일 시스템 지원-https://lwn.net/Articles/ [23] 이주 창, 김기홍, 차 성경. 차등 로깅 : 고도의 병렬 주 메모리 데이터베이스를위한 교환 및 연관 로깅 체계입니다. In Proceedings 17th International Conference on Data En-gineering, pages 173–182, pages 2001. [24] Rohan Kadekodi, 이세권, Sanidhya Kashyap, 김태수, Aasheesh Kolli, Vijay Chidambaram. Splitfs : 27 번째 ACM 영구 메모리의 In Proceedings에 대한 파일 시스템의 소프트웨어 오버 헤드를 줄입니다. 운영 체제 원칙 심포지엄, SOSP ’19, 페이지 494–508, 미국 뉴욕, 뉴욕, 2019. ACM. [25] 김형준, 이영식, 김진수. NVMeDirect : NVMe SSD에서 애플리케이션 별 최적화를위한 사용자 공간 I / O 프레임 워크. 스토리지 및 파일 시스템의 핫 토픽에 대한 8 차 USENIX 워크숍에서 HotStorage ’16. USENIX Association, 2016. [26] 김현준, 안준욱, 류성태, 최정식, 한환수. 비 휘발성 메모리 용 인 메모리 파일 시스템. Proceedings of the 2013 Research in Adaptive and Convergent Systems, RACS ’13, page 479–484, New York, NY, USA, 2013. Association for Computing Machinery. [27] 김욱희, 김진웅, 백웅기, 남 범석, 원유집. NVWAL : 미리 쓰기 로깅에서 NVRAM 악용. 프로그래밍 언어 및 운영 시스템에 대한 아키텍처 지원에 관한 제 21 회 국제 회의 회보, ASPLOS ’16. ACM, 2016 년.[28] 권영진, Henrique Fingler, Tyler Hunt, Simon Peter, Emmett Witchel, Thomas Anderson. Strata : 크로스 미디어 파일 시스템. 운영 체제 원칙에 대한 26 차 심포지엄 회보, SOSP ’17, 페이지 460–477, 미국 뉴욕, 뉴욕, 2017. ACM. [29] 권영진, 유 항첸, 사이먼 피터, 크리스토퍼 J. 로스 바흐, 에밋 위첼. Ingens와 함께 조정되고 효율적인 방대한 페이지 관리. 운영 체제 설계 및 구현에 관한 12 차 USENIX 컨퍼런스, OSDI’16, 페이지 705–721, 미국, 2016. USENIX Association. E. Kültürsay, M. Kandemir, A. Sivasubramaniam 및 O. Mutlu. 에너지 효율적인 주 메모리 대안으로 stt-ram을 평가합니다. 시스템 및 소프트웨어의 성능 분석에 관한 2013 년 IEEE 국제 심포지엄, ISPASS ’13, 2013 년 4 월. [31] Butler W. Lampson. 컴퓨터 시스템 설계를위한 힌트. 운영 체제 원칙에 관한 제 9 회 ACM 심포지엄에서, SOSP ’83, 33–48 페이지, 미국 뉴욕, 뉴욕, 1983. ACM. B. C. Lee, P. Zhou, J. Yang, Y. Zhang, B. Zhao, E. Ipek, O. Mutlu 및 D. Burger. 위상 변화 기술과 메인 메모리의 미래. IEEE Micro, 30 (1) : 143–143, 2010 년 1 월. [33] Benjamin C. Lee, Engin Ipek, Onur Mutlu 및 Doug Burger. 확장 가능한 드램 대안으로 위상 변화 메모리를 설계합니다. 제 36 회 컴퓨터 아키텍처 국제 심포지엄 회보, ISCA ’09. ACM, 2009. [34] Edward K. Lee와 Chandramohan A. Thekkath. Petal : 분산 가상 디스크. 프로그래밍 언어 및 운영 체제에 대한 아키텍처 지원에 관한 제 7 회 국제 컨퍼런스, AS-PLOS VII, 84-92 페이지, 미국 뉴욕, 미국, 1996 년 ACM.[35] 이규선, 진원 징, 송 원석, 공정훈, 배종현, 한태준, 이재 W., 정진규. 하드웨어 기반 수요 페이지 화 사례. 컴퓨터 아키텍처에 관한 제 47 회 연례 국제 심포지엄 회보, ISCA ’20, 페이지 1103–1116, 미국 뉴욕, 뉴욕, 2020. ACM. 이상원과 문봉기. 플래시 기반 dbms의 설계 : 페이지 내 로깅 접근 방식. 2007 ACM SIGMOD International Conference on Management of Data, SIGMOD ’07, page 55–66, New York, NY, USA, 2007. Association for Computing Machinery. Bojie Li, Tianyi Cui, Zibo Wang, Wei Bai 및 Lintao Zhang. Socksdirect : 데이터 센터 소켓은 빠르고 호환 가능합니다. 데이터 통신에 관한 ACM 시그 (SIG), SIGCOMM ’19, 페이지 14 2020 USENIX 연례 기술 컨퍼런스 USENIX Association 90–103, 미국 뉴욕, 미국, 2019 년. Association for Computing Machinery. [38] Sihang Liu, Yizhou Wei, Jishen Zhao, Aasheesh Kolli 및 Samira Khan. Pmtest : 영구 메모리 프로그램에 대한 Pro-framework에서 빠르고 유연한 테스트. 프로그래밍 언어 및 운영 체제를위한 아키텍처 지원에 관한 24 차 국제 컨퍼런스, ASPLOS ’19, 411–425 페이지, 미국 뉴욕, 뉴욕, 2019 년. 컴퓨팅 기계 협회. Amirsaman Memaripour와 Steven Swanson. Breeze : 레거시 소프트웨어의 비 휘발성 기본 메모리에 대한 사용자 수준 액세스. 2018 년 IEEE 36st International Conference on Computer Design, ICCD ’18. IEEE, 2018. [40] 민 창우, Sanidhya Kashyap, Steffen Maass, 김태수. 파일 시스템의 manycore 확장 성 이해. 2016 년 USENIX 연례 기술 컨퍼런스 (USENIX ATC 16), 71–85 페이지, 콜로라도 주 덴버, 2016 년 6 월. USENIX Association. Mobibench. Mobibench. https://github.com/ESOS-Lab/ [42] C. Mohan. 양자리를 넘어서 반복되는 역사. 초대형 데이터베이스에 관한 제 25 차 국제 컨퍼런스, VLDB ’99, 1–17 페이지, 미국 캘리포니아 주 샌프란시스코, 1999 년 모건 카우프만 출판사. C. Mohan, Don Haderle, Bruce Lindsay, Hamid Pira-hesh 및 Peter Schwarz. 양자리 : 미리 쓰기 (write-ahead) 로깅을 사용하는 미세 세분화 잠금 및 부분 롤백을 지원하는 트랜잭션 복구 방법입니다. ACM Trans. Database Syst., 17 (1) : 94–162, 1992 년 3 월. [44] MongoDB. https://www.mongodb.com. 넷리스트 NVvault DDR4 NVDIMM-N. https : //www.netlist.com/products/specialty-dimms/nvvault-ddr4-nvdimm. [46] Jiaxin Ou, Jiwu Shu 및 Youyou Lu. 비 휘발성 메인 메모리를위한 고성능 파일 시스템. 제 11 차 컴퓨터 시스템에 관한 유럽 회의 회보, EuroSys ’16. ACM, 2016. [47] Ashish Panwar, Aravinda Prasad 및 K. Gopinath. Proceedings에서 거대한 페이지를 실제로 유용하게 만듭니다. 프로그래밍 언어 및 운영 체제에 대한 아키텍처 지원에 관한 23 번째 국제 컨퍼런스, ASPLOS ’18, 679–692 페이지, 미국 뉴욕, 뉴욕, 2018. ACM. 짐 파파스. 인터페이스에 대한 연례 업데이트, 2014. https://www.flashmemorysummit.com/English/ Collaterals / Proceedings / 2014 / 20140805_U3_ Pappas.pdf. [49] 박대준과 신동건. ijournaling : fsync 시스템 호출의 지연 시간을 개선하기위한 세분화 된 저널링입니다. 2017 년 USENIX 연례 기술 회의 (USENIX ATC 17), 787–798 페이지, 캘리포니아 산타 클라라, 2017 년 7 월. USENIX Association. Stan Park, Terence Kelly 및 Kai Shen. 실패 원자 msync () : 내구성있는 데이터의 무결성을 보존하기위한 간단하고 효율적인 메커니즘입니다. 제 8 회 컴퓨터 시스템에 관한 ACM 유럽 컨퍼런스, EuroSys ’13. ACM, 2013. [51] Thanumalayan Sankaranarayana Pillai, Ramnatthan Ala- gappan, Lanyue Lu, Vijay Chidambaram, Andrea C Arpaci-Dusseau 및 Remzi H Arpaci-Dusseau. CCFS를 사용한 애플리케이션 충돌 일관성 및 성능. 15 차 USENIX 파일 및 스토리지 기술 컨퍼런스에서 FAST ’17. USENIX Association, 2017. [52] Thanumalayan Sankaranarayana Pillai, Vijay Chi- dambaram, Ramnatthan Alagappan, Samer Al-Kiswany, Andrea C. Arpaci-Dusseau 및 Remzi H. Arpaci- Dusseau. 모든 파일 시스템이 동일하게 만들어지지는 않습니다. 충돌 일관된 응용 프로그램을 만드는 복잡성. 운영 체제 설계 및 구현에 관한 11 차 USENIX 심포지엄에서 OSDI ’14. USENIX 협회, 2014.Vijayan Prabhakaran, Andrea C. Arpaci-Dusseau 및 Remzi H. Arpaci-Dusseau. 저널링 파일 시스템의 진행 과정에서 분석 및 진화. USENIX 연례 기술 회의에 대한 nual Conference, ATEC ’05, 8-8 페이지, 미국 캘리포니아 주 버클리, 2005. USENIX Association. S. Qiu 및 A. L. N. Reddy. 비 휘발성 메모리 파일 시스템에서 수퍼 페이지를 악용합니다. 2012 년 IEEE 28 차 대용량 저장 시스템 및 기술 심포지엄 (MSST), 1-5 페이지, 2012 년 4 월. [55] S. Raoux, G. W. Burr, M. J. Breitwisch, C. T. Rettner, Y.. Chen, R. M. Shelby, M. Salinga, D. Krebs, S.. Chen, H.. Lung 및 C.H. Lam. 위상 변화 랜덤 액세스 메모리 : 확장 가능한 기술. IBM Journal of Research and Development, 52 (4.5) : 465–479, 2008 년 7 월. [56] Ohad Rodeh, Josef Bacik 및 Chris Mason. Btrfs : 리눅스 b- 트리 파일 시스템. Trans. Storage, 9 (3) : 9 : 1–9 : 32, 2013 년 8 월. USENIX Association 2020 USENIX 연례 기술 컨퍼런스 15 [57] Livio Soares 및 Michael Stumm. FlexSC : 예외없는 시스템 호출을 통한 유연한 시스템 호출 스케줄링. 운영 시스템 설계 및 구현에 관한 제 9 차 USENIX 컨퍼런스, OSDI’10. USENIX Association, 2010. [58] 송내영, 손용석, 한혁, 염헌영. 고속 저장 장치에서 효율적인 메모리 매핑 I / O. ACM Transactions on Storage, 12 (4) : 19 : 1–19 : 27, 2016. [59] SQLite. https://www.sqlite.org. 마이클 M. 스위프트. o (1) 메모리를 향해. 운영 체제의 핫 토픽에 대한 16 차 워크숍, HotOS ’17 진행. ACM, 2017. [61] C. Villavieja, V. Karakostas, L. Vilanova, Y. Etsion, A. Ramirez, A. Mendelson, N. Navarro, A. Cristal, O. S. Unsal. Didi : 공유 tlb 디렉토리를 사용하여 tlb 슈팅 다운의 성능 영향을 완화합니다. 2011 년 병렬 아키텍처 및 컴파일 기법에 관한 국제 컨퍼런스, 340–349 페이지, 2011 년 10 월. [62] Haris Volos, Sanketh Nalli, Sankarlingam Panneersel-vam, Venkatanathan Varadarajan, Prashant Saxena 및 Michael M. Swift. Aerie : 스토리 지급 메모리에 대한 유연한 파일 시스템 인터페이스. 제 9 회 컴퓨터 시스템에 관한 유럽 회의 회보, EuroSys ’14. ACM, 2014.[63] Yang Wang, Manos Kapritsos, Zuocheng Ren, Prince Mahajan, Jeevitha Kirubanandam, Lorenzo Alvisi 및 Mike Dahlin. Salus 확장형 블록의 견고 함 제 10 회 USENIX 컨퍼런스 진행 중. ence on Networked Systems Design and Implementation, nsdi’13, page 357–370, USA, 2013. USENIX Associa- tion. David A. Wheeler. SLOCCount. https : // dwheeler. com / sloccount /. Xiaojian Wu 및 A. L. Narasimha Reddy. SCMFS : 스토리지 클래스 메모리 용 파일 시스템. 2011 년 고성능 컴퓨팅, 네트워킹, 스토리지 및 분석을위한 국제 컨퍼런스, SC ’11. ACM, 2011. [66] Jian Xu, Juno Kim, Amirsaman Memaripour, 연주 찾기 및 수정 Steven Swanson. 영구 메모리 소프트웨어 스택의 병리. 프로그래밍 언어 및 운영 체제를위한 아키텍처 지원에 관한 24 차 국제 회의 회보, ASPLOS ’19, 페이지 427–439, 미국 뉴욕, 미국, 2019 년 컴퓨팅 기계 협회. Jian Xu와 Steven Swanson. NOVA : 하이브리드 휘발성 / 비 휘발성 메인 메모리를위한 로그 구조 파일 시스템. 14 차 USENIX 파일 및 스토리지 기술 컨퍼런스에서 FAST ’16. USENIX 협회, 2016. [68] Jian Xu, Lu Zhang, Amirsaman Memaripour, Akshatha Gangadharaiah, Amit Borase, Tamires Brito Da Silva, Steven Swanson, Andy Rudoff. NOVA-Fortis : 내결함성이있는 비 휘발성 메인 메모리 파일 시스템. 26 회 운영 체제 원칙 심포지엄에서 SOSP ’17. ACM, 2017. [69] 양지 수, 데이브 B. 민턴, 프랭크 하디. In Proceedings의 투표가 인터럽트보다 낫습니다. 파일 및 스토리지 기술에 관한 10 차 USENIX 컨퍼런스, FAST’12, 3–3 페이지, 미국 캘리포니아 주 버클리, 2012. USENIX Association. [70] Jun Yang, Qingsong Wei, Cheng Chen, Chundong Wang, Khai Leong Yong 및 Bingsheng He. Nv-tree : nvm 기반 단일 레벨 시스템의 일관성 비용을 줄입니다. 13 차 USENIX 파일 및 스토리지 기술 컨퍼런스에서 FAST ’15. USENIX Association, 2015. [71] Mai Zheng, Joseph Tucek, Dachuan Huang, Feng Qin, Mark Lillibridge, Elizabeth S. Yang, Bill W Zhao 및 Shashank Singh. 재미와 이익을 위해 데이터베이스를 고문합니다. 11 차 USENIX 운영 체제 설계 및 구현 심포지엄에서 OSDI ’14. USENIX Associa- tion, 2014. 16 2020 USENIX 연례 기술 컨퍼런스 USENIX Association"


    from_py_string = "";
    from_py_translation = "";
    from_py_original = from_py_original["hits"]["hits"][0]["_source"]
    from_py_translate = from_py_translate["hits"]["hits"][0]["_source"]

    for (title in from_py_original) {
      from_py_string += title + "\n\n";
      for (small_title in from_py_original[title]) {
        from_py_string += small_title + "\n\n";
        for (key in from_py_original[title][small_title])
          //console.log(from_py_original[title][small_title][key])
          from_py_string += from_py_original[title][small_title][key];
        from_py_string += "\n\n";
      }
    }

    for (title in from_py_translate) {
      from_py_translation += title + "\n\n";
      for (small_title in from_py_translate[title]) {
        from_py_translation += small_title + "\n\n";
        for (key in from_py_translate[title][small_title])
          //console.log(from_py_original[title][small_title][key])
          from_py_translation += from_py_translate[title][small_title][key];
        from_py_translation += "\n\n";
      }
    }

    console.log('\n\n\n\DB storage step\n\n\n');
    //console.log("Before storage in DB : ", from_py_string);
    //post.attachment.translated();
    post.attachment.original = from_py_string;
    post.attachment.translate = from_py_translation;

    res.render('posts/trans', {
      post: post
    });
  } else {
  console.log('already translated')
    res.render('posts/trans', {
      post: post
    });
  }

});

// edit=========================================================================
router.get('/:id/edit', util.isLoggedin, checkPermission, function(req, res) {
  var post = req.flash('post')[0];
  var errors = req.flash('errors')[0] || {};
  if (!post) {
    // 업데이트 과정에서 오류가 발생해서 다시 돌아온 경우
    Post.findOne({
        _id: req.params.id
      })
      .populate({
        path: 'attachment',
        match: {
          isDeleted: false
        }
      })
      .exec(function(err, post) {
        if (err) return res.json(err);
        res.render('posts/edit', {
          post: post,
          errors: errors
        });
      });
  } else {
    // 처음 Edit 페이지에 접근한 경우
    post._id = req.params.id;
    res.render('posts/edit', {
      post: post,
      errors: errors
    });
  }
});

// update=======================================================================
router.put('/:id', util.isLoggedin, checkPermission, upload.single('newAttachment'), async function(req, res) {
  var post = await Post.findOne({
    _id: req.params.id
  }).populate({
    path: 'attachment',
    match: {
      isDeleted: false
    }
  });
  if (post.attachment && (req.file || !req.body.attachment)) {
    post.attachment.processDelete();
  }
  req.body.attachment = req.file ? await File.createNewInstance(req.file, req.user._id, req.params.id) : post.attachment;
  req.body.updatedAt = Date.now();
  Post.findOneAndUpdate({
    _id: req.params.id
  }, req.body, {
    runValidators: true
  }, function(err, post) {
    if (err) {
      req.flash('post', req.body);
      req.flash('errors', util.parseError(err));
      return res.redirect('/posts/' + req.params.id + '/edit' + res.locals.getPostQueryString());
    }
    res.redirect('/posts/' + req.params.id + res.locals.getPostQueryString());
  });
});

// destroy======================================================================
router.delete('/:id', util.isLoggedin, checkPermission, function(req, res) {
  Post.deleteOne({
    _id: req.params.id
  }, function(err) {
    if (err) return res.json(err);
    res.redirect('/posts' + res.locals.getPostQueryString());
  });
});

module.exports = router;

// private functions============================================================
function checkPermission(req, res, next) {
  Post.findOne({
    _id: req.params.id
  }, function(err, post) {
    if (err) return res.json(err);
    if (post.author != req.user.id) return util.noPermission(req, res);

    next();
  });
}

async function createSearchQuery(queries) {
  var searchQuery = {};
  if (queries.searchType && queries.searchText && queries.searchText.length >= 3) {
    var searchTypes = queries.searchType.toLowerCase().split(',');
    var postQueries = [];
    if (searchTypes.indexOf('title') >= 0) {
      postQueries.push({
        title: {
          $regex: new RegExp(queries.searchText, 'i')
        }
      });
    }
    if (searchTypes.indexOf('body') >= 0) {
      postQueries.push({
        body: {
          $regex: new RegExp(queries.searchText, 'i')
        }
      });
    }
    if (searchTypes.indexOf('author!') >= 0) {
      var user = await User.findOne({
        username: queries.searchText
      }).exec();
      if (user) postQueries.push({
        author: user._id
      });
    } else if (searchTypes.indexOf('author') >= 0) {
      var users = await User.find({
        username: {
          $regex: new RegExp(queries.searchText, 'i')
        }
      }).exec();
      var userIds = [];
      for (var user of users) {
        userIds.push(user._id);
      }
      if (userIds.length > 0) postQueries.push({
        author: {
          $in: userIds
        }
      });
    }
    if (postQueries.length > 0) searchQuery = {
      $or: postQueries
    };
    else searchQuery = null;
  }
  return searchQuery;
}
