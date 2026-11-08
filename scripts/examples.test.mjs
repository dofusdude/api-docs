import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cases, resolve, examples, request } from './check-examples.mjs';

const spec=YAML.parse(fs.readFileSync(new URL('../openapi-3.2.yaml',import.meta.url),'utf8'));
const ajv=new Ajv({strict:false,allErrors:true}); addFormats(ajv);ajv.addSchema(spec,'https://examples.test/spec');
test('beta website follows the beta branch without targeting the stable API',()=> {
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/https:\/\/raw\.githubusercontent\.com\/dofusdude\/api-docs\/beta\/openapi-3\.2\.yaml/);
  assert.equal(spec.servers[0].url,'https://beta.api.dofusdu.de');
  assert.ok(!spec.servers.some(server=>server.url==='https://api.dofusdu.de'));
  assert.deepEqual(spec.components.parameters.Game.schema.enum,['dofus3']);
});
function validate(schema,value,label) {
  const check=ajv.compile({...schema,components:spec.components});
  assert.ok(check(value),`${label}: ${ajv.errorsText(check.errors)}`);
}
test('every public GET/QUERY/OPTIONS operation produces an executable example',()=> {
  const plan=cases(spec);
  const total=Object.entries(spec.paths).filter(([p])=>p.includes('/v1/')).reduce((n,[,p])=>n+['get','query','options'].filter(m=>p[m]).length,0);
  assert.ok(plan.length>=total);
  assert.ok(plan.every(c=>!c.path.includes('{')));
});
test('all generated request bodies and JSON filter examples match their schemas',()=> {
  for(const [path,item]of Object.entries(spec.paths)) {
    for(const [method,operation]of Object.entries(item)) {
      if(!['get','query'].includes(method))continue;
      for(const raw of [...(item.parameters??[]),...(operation.parameters??[])]) {
        const parameter=resolve(spec,raw);
        const media=parameter.content?.['application/json'];
        if(media) for(const value of examples(spec,media)) validate(media.schema,value,`${path} filter`);
        if(parameter.schema) for(const value of examples(spec,parameter)) validate(parameter.schema,value,`${path} ${parameter.name}`);
      }
      const media=operation.requestBody?.content?.['application/json'];
      if(media) for(const value of examples(spec,media)) validate(media.schema,value,`${path} body`);
    }
  }
});
test('recursive filter examples never contain Swagger string placeholders',()=> {
  for(const schema of Object.values(spec.components.schemas)) {
    if(!schema.properties?.and)continue;
    assert.ok(schema.example);
    assert.ok(!JSON.stringify(schema.example).includes('"string"'));
  }
});

test('documentation prose has no semicolons and filter descriptions stay resource-specific',()=> {
  function check(value) {
    if(!value || typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)) {
      if(['description','summary','title'].includes(key) && typeof child==='string') assert.ok(!child.includes(';'),child);
      check(child);
    }
  }
  check(spec);
  for(const name of ['Class','SuperArea','Area','Subarea']) {
    assert.doesNotMatch(spec.components.schemas[`${name}QueryFilter`].description,/\b(spell|monster)\b/i);
  }
  assert.doesNotMatch(spec.components.schemas.MonsterQueryFilter.description,/\bspell\b/i);
  assert.doesNotMatch(spec.components.schemas.SpellQueryFilter.description,/\bmonster\b/i);
});

test('live checker consumes and validates complete streamed JSON',async()=> {
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.write('{"items":[');res.write('"'+ 'x'.repeat(2*1024*1024)+'"');res.end(']}');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {assert.equal((await request(`http://127.0.0.1:${server.address().port}`,{path:'/',method:'GET'})).status,200);}
  finally {await new Promise(done=>server.close(done));}
});
test('live checker rejects truncated JSON even with a 200 status',async()=> {
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"items":[');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {await assert.rejects(request(`http://127.0.0.1:${server.address().port}`,{path:'/',method:'GET'}));}
  finally {await new Promise(done=>server.close(done));}
});
