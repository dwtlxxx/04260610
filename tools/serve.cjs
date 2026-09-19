const http=require("http"),fs=require("fs"),path=require("path");
const root=process.argv[2],port=Number(process.argv[3]||8000);
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".ico":"image/x-icon"};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split("?")[0]); if(p==="/")p="/index.html";
  const f=path.join(root,p);
  if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end("404");return}
  res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream","Cache-Control":"no-store"});
  fs.createReadStream(f).pipe(res);
}).listen(port,"127.0.0.1",()=>console.log("serving "+root+" at http://127.0.0.1:"+port+"/"));