import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import streamJson from 'stream-json';

export function resolve(spec, value) {
  while (value?.$ref) value = value.$ref.slice(2).split('/').reduce((v,k)=>v[k], spec);
  return value;
}
export function examples(spec, value) {
  value = resolve(spec, value);
  if (value?.examples) return Object.values(value.examples).map(e=>e.value);
  if (value?.example !== undefined) return [value.example];
  if (value?.schema) return examples(spec, value.schema);
  if (value?.default !== undefined) return [value.default];
  return [];
}
export function cases(spec) {
  const result=[];
  for (const [path,item] of Object.entries(spec.paths)) {
    // Webhook administration requires credentials and user-owned resource IDs.
    if (!path.includes('/v1/')) continue;
    for (const method of ['get','query','options']) {
      const operation=item[method]; if (!operation) continue;
      const parameters=[...(item.parameters??[]),...(operation.parameters??[])].map(p=>resolve(spec,p));
      let target=path;
      const query=new URLSearchParams(); const variants=[];
      for (const parameter of parameters) {
        const media=parameter.content?.['application/json'];
        const values=examples(spec,media??parameter);
        let value=values[0];
        if (parameter.in==='path') {
          if(parameter.name==='game') value='dofus3';
          else if(parameter.name==='language') value='en';
          else if(value===undefined) throw Error(`Missing path example: ${path} ${parameter.name}`);
          target=target.replace(`{${parameter.name}}`,encodeURIComponent(value));
        } else if(parameter.in==='query') {
          if(value===undefined && parameter.required) throw Error(`Missing required example: ${path} ${parameter.name}`);
          if(value!==undefined) query.set(parameter.name,media?JSON.stringify(value):Array.isArray(value)?value.join(','):String(value));
          for(const extra of values.slice(1)) variants.push([parameter.name,JSON.stringify(extra)]);
        }
      }
      const bodies=method==='query'?examples(spec,operation.requestBody.content['application/json']):[undefined];
      if(!bodies.length) throw Error(`Missing request example: ${path}`);
      const add=(params,body,label)=>result.push({method:method.toUpperCase(),path:target+(params.size?'?'+params:''),body,label:`${method.toUpperCase()} ${path}${label}`,operation});
      for(const body of bodies) add(query,body,'');
      for(const [name,value] of variants) { const q=new URLSearchParams(query);q.set(name,value);add(q,bodies[0],` (${name} alternative)`); }
    }
  }
  for (const match of (spec.info.description??'').matchAll(/^GET (\/\S+)$/gm)) {
    result.push({method:'GET',path:match[1],label:`GUIDE GET ${match[1]}`});
  }
  return result;
}
export function request(base, test, address, preflight) {
  const url=new URL(test.path,base);
  const headers={Origin:'https://beta.docs.dofusdu.de'};
  if(preflight) Object.assign(headers,{'Access-Control-Request-Method':test.method,'Access-Control-Request-Headers':'content-type'});
  if(test.body!==undefined) headers['Content-Type']='application/json';
  return new Promise((done,fail)=> {
    const req=(url.protocol==='https:'?https:http).request(url,{method:preflight?'OPTIONS':test.method,headers,
      ...(address?{lookup:(_h,o,cb)=>o.all?cb(null,[{address,family:4}]):cb(null,address,4)}:{})},res=> {
        // Consume the entire export without retaining hundreds of MB in memory.
        let body='';
        const finish=()=>done({status:res.statusCode,headers:res.headers,body});
        const json=res.statusCode>=200 && res.statusCode<300 && res.statusCode!==204 ? streamJson() : undefined;
        if(json) {
          json.on('data',()=>{});
          json.on('error',fail);
          json.on('end',finish);
          res.pipe(json);
        }
        res.on('data',c=>{if(res.statusCode>=400 && body.length<2000)body+=c});
        res.on('aborted',()=>fail(Error('Truncated response')));
        res.on('error',fail);
        res.on('end',()=> {if(!json)finish();});
      });
    req.on('error',fail);req.setTimeout(120000,()=>req.destroy(Error('Request timed out')));
    req.end(!preflight&&test.body!==undefined?JSON.stringify(test.body):undefined);
  });
}
export async function check(filename,base,address) {
  const spec=YAML.parse(fs.readFileSync(filename,'utf8'));let count=0;const failures=[];
  for(const test of cases(spec)) {
    try {
      const response=await request(base,test,address);
      if(response.status<200 || response.status>=300) throw Error(`${response.status}: ${response.body}`);
      if(response.headers['access-control-allow-origin']!=='*') throw Error('Missing CORS origin');
      if(['QUERY','OPTIONS'].includes(test.method)) {
        const preflight=await request(base,test,address,true);
        if(preflight.status!==204 || !preflight.headers['access-control-allow-methods']?.split(/,\s*/).includes(test.method)) throw Error(`Preflight failed: ${preflight.status}`);
      }
      console.log(`PASS ${test.label} (${response.status})`);count++;
    } catch(error) {failures.push(test.label+': '+error.message);console.error('FAIL',failures.at(-1));}
  }
  console.log(`${count} examples passed; ${failures.length} failed`);
  if(failures.length) throw Error(failures.join('\n'));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.env.API_TEST_BASE_URL) throw Error('Set API_TEST_BASE_URL to the API origin');
  await check(process.argv[2]??'openapi-3.2.yaml',process.env.API_TEST_BASE_URL,process.env.API_TEST_ADDRESS);
}
