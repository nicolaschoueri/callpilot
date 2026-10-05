const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
for(const page of ['index.html','friendly.html']){
 const html=fs.readFileSync(page,'utf8');
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 const intake=html.slice(html.indexOf('function adaptiveFresh()'),html.indexOf('function adaptiveReply(text)'));
 const c=vm.createContext({adaptive:null,selectedLang:'en'});vm.runInContext(intake,c);
 function reset(lang){c.selectedLang=lang;vm.runInContext('adaptive=adaptiveFresh()',c)}
 function answer(text){c.text=text;vm.runInContext('adaptiveAbsorb(text)',c);return vm.runInContext('adaptiveNext()',c)}
 reset('en');
 assert.match(answer("I'm a homeowner"),/name/);assert.equal(c.adaptive.name,null);
 answer('Nick');answer('45 Main Street');answer('My kitchen sink leaks');
 assert.match(answer('Regular appointment'),/day and time/);assert.equal(c.adaptive.time,null);
 assert.match(answer('Tomorrow at 10 am'),/callback/);assert.equal(answer('5145550123'),null);
 reset('fr');answer('Je suis entrepreneur');answer('Construction ABC');answer('Nick, directeur');answer('45 rue Main');answer('Fuite dans un tuyau');
 assert.match(answer('Urgence aujourd’hui'),/date.*heure/);assert.equal(c.adaptive.time,null);
 answer('Demain à 10 h');answer('5145550123');assert.equal(answer('n/a'),null);assert.equal(c.adaptive.po,'none');
 reset('en');c.adaptive.type='homeowner';answer('5145550123');assert.equal(c.adaptive.time,null);
 console.log('PASS '+page+': script syntax, EN homeowner / FR contractor intake, date/time, phone, optional PO');
}
