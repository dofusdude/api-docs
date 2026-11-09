import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root=new URL('../',import.meta.url);
const spec=YAML.parse(fs.readFileSync(new URL('openapi-3.2.yaml',root),'utf8'));
const guide=fs.readFileSync(new URL('CONCEPTS.md',root),'utf8').trim();
test('concept guide is embedded in the published Swagger description',()=> {
  assert.ok(spec.info.description.endsWith(guide));
  for(const heading of ['Grades are variants','Following and expanding relationships','Effects, targeting','World areas, spawn locations','Conditions and incomplete','Choosing response size']) assert.ok(guide.includes(heading),heading);
});
test('grade and field documentation distinguishes IDs, variants and levels',()=> {
  const schemas=spec.components.schemas;
  assert.match(schemas.SpellLevel.properties.ankama_id.description,/Different from the parent spell ID/);
  assert.match(schemas.MonsterGrade.properties.level.description,/Combat level/);
  assert.match(schemas.MonsterSpellRelationship.properties.grade.description,/does not need to equal/);
  assert.match(schemas.MonsterSpawnLocation.properties.subarea_maps.description,/not proof/);
  assert.equal(schemas.SpellEffect.properties.templated.type,'string');
  assert.equal(schemas.SpellEffect.properties.type.type,'string');
});
test('documented grade relationships match the running API', {skip:!process.env.API_TEST_BASE_URL},async()=> {
  const base=process.env.API_TEST_BASE_URL;
  async function get(path) {
    const response=await fetch(new URL(path,base));assert.equal(response.status,200,path);return response.json();
  }
  const monster=await get('/dofus3/v1/en/monsters/31');
  const assigned=monster.grades[0].spells[0];
  const spell=await get(assigned.url);
  assert.equal(spell.ankama_id,assigned.ankama_id);
  assert.equal(spell.levels.length,1);
  assert.equal(spell.levels[0].grade,assigned.grade);
  assert.notEqual(spell.levels[0].ankama_id,spell.ankama_id);
  const expanded=await get('/dofus3/v1/en/monsters/31?include=spells.grade');
  assert.equal(expanded.grades[0].spells[0].levels[0].grade,assigned.grade);
  assert.equal(expanded.grades[0].spells[0].levels.length,1);
  const full=await get('/dofus3/v1/en/monsters/31?include=spells');
  const independent=await get(`/dofus3/v1/en/spells/${assigned.ankama_id}`);
  assert.deepEqual(full.grades[0].spells[0].levels.map(l=>l.grade),independent.levels.map(l=>l.grade));
  const playable=await get('/dofus3/v1/en/classes/1');
  assert.ok(playable.spells.length>0);
  assert.ok(playable.spells.every(s=>Array.isArray(s.levels)));
  assert.equal(playable.grades,undefined);
  const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
  for(const [name,body]of [['Monster',monster],['Spell',spell],['Class',playable]]) {
    const validate=ajv.compile({...spec.components.schemas[name],components:spec.components});
    assert.ok(validate(body),`${name}: ${ajv.errorsText(validate.errors)}`);
  }
});
