(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CallPilotDemoCore=api;})(typeof window!=='undefined'?window:this,function(){
 const fields={
  issue:['What service do you need? You can also ask to cancel, reschedule, or speak to the owner.','De quel service avez-vous besoin? Vous pouvez aussi demander d’annuler ou de reporter un rendez-vous, ou de parler au propriétaire.'],
  scope:['Please describe the service problem or work you need.','Veuillez décrire le problème ou les travaux dont vous avez besoin.'],
  type:['Are you calling for your own home, as a contractor, for a property you manage, or for a business?','Appelez-vous pour votre résidence, comme entrepreneur, pour un immeuble que vous gérez ou pour une entreprise?'],
  company:["What's the name of your company?",'Quel est le nom de votre entreprise?'],
  name:['May I have your name, please?','Puis-je avoir votre nom, s’il vous plaît?'],
  role:["What's your role and who will be the on-site contact?",'Quel est votre rôle et qui sera la personne-ressource sur place?'],
  city:['Perfect. What city are you located in?','Parfait. Dans quelle ville êtes-vous situé?'],
  address:["What's the full service address, including the street number and street name?",'Quelle est l’adresse complète de service, incluant le numéro civique et le nom de la rue?'],
  property:['Which property or building is this for?','Pour quel immeuble ou quelle propriété appelez-vous?'],
  unit:['Is there a specific unit or suite number?','Y a-t-il un numéro d’unité ou de local?'],
  safety:['Is there fire, smoke, a gas smell, electrical sparking, or any immediate danger?','Y a-t-il un incendie, de la fumée, une odeur de gaz, des étincelles électriques ou un danger immédiat?'],
  urgency:['Is this an emergency requiring service today, or a regular service request?','S’agit-il d’une urgence nécessitant un service aujourd’hui ou d’une demande régulière?'],
  access:['How should the technician access the property or coordinate with the tenant?','Comment le technicien doit-il accéder à la propriété ou coordonner l’accès avec le locataire?'],
  authorization:['Are you authorized to request this work, or who needs to approve it?','Êtes-vous autorisé à demander ces travaux ou qui doit les approuver?'],
  impact:['Is this affecting your operations or preventing the business from operating normally?','Est-ce que ce problème affecte vos opérations ou empêche l’entreprise de fonctionner normalement?'],
  date:['What date would you prefer for the service?','Quelle date préférez-vous pour le service?'],
  time:['What time or arrival window would you prefer?','Quelle heure ou quelle plage d’arrivée préférez-vous?'],
  dispatch:['For this urgent request, what dispatch time would you prefer today? The owner must confirm availability.','Pour cette demande urgente, à quelle heure souhaitez-vous une intervention aujourd’hui? Le propriétaire doit confirmer les disponibilités.'],
  phone:["What's the best callback number?",'Quel est le meilleur numéro pour vous joindre?'],
  po:['Do you have a PO or job number for this request? You can say no.','Avez-vous un numéro de bon de commande ou de projet pour cette demande? Vous pouvez dire non.'],
  original:['What is the date and time of the appointment you want to change?','Quelle est la date et l’heure du rendez-vous que vous souhaitez modifier?'],
  reason:['What would you like the owner to know?','Que souhaitez-vous communiquer au propriétaire?']
 };
 const messages={
  greeting:["Thank you for calling. I'm Ava. How can I help you today?",'Merci d’avoir appelé. Ici Ava. Comment puis-je vous aider aujourd’hui?'],
  danger:['If there is immediate danger, move to a safe place and contact local emergency services. This demo cannot dispatch emergency assistance. I can collect a callback request for the business.','En cas de danger immédiat, mettez-vous en sécurité et contactez les services d’urgence locaux. Cette démo ne peut pas envoyer de secours. Je peux recueillir une demande de rappel pour l’entreprise.'],
  area:['This location is outside the configured service area. I can record a request for the owner to review, but cannot promise service.','Cette adresse est à l’extérieur de la zone de service configurée. Je peux recueillir une demande à examiner par le propriétaire, sans promettre de service.'],
  hours:['The business is currently outside its configured hours. I can collect a callback request; the owner must confirm the response time.','L’entreprise est actuellement fermée selon l’horaire configuré. Je peux recueillir une demande de rappel; le propriétaire doit confirmer le délai de réponse.'],
  handoff:['I can record your request for the owner to call you back. This website demo does not transfer a real phone call.','Je peux recueillir votre demande de rappel par le propriétaire. Cette démo sur le site ne transfère pas de véritable appel.'],
  filter:['I will classify this as a sales or spam call and keep it separate from customer service requests.','Je vais classer cet appel comme sollicitation commerciale ou pourriel et le séparer des demandes de service.'],
  review:['Please review the details on screen, especially your address, phone number, date and time. You can correct any field before confirming.','Veuillez vérifier les détails à l’écran, surtout l’adresse, le téléphone, la date et l’heure. Vous pouvez corriger chaque champ avant de confirmer.'],
  complete:['Thank you. Your simulated request is saved in the demo portal for owner review. No real appointment, dispatch or text message has been sent.','Merci. Votre demande simulée est enregistrée dans le portail démo pour examen par le propriétaire. Aucun vrai rendez-vous, envoi de technicien ou message texte n’a été effectué.'],
  invalidPhone:['Please provide a ten-digit callback number, including the area code.','Veuillez fournir un numéro de rappel de dix chiffres, incluant l’indicatif régional.'],
  invalidAddress:['Please include the street number and street name in the service address.','Veuillez inclure le numéro civique et le nom de la rue dans l’adresse de service.'],
  unknownType:['Please choose homeowner, contractor, property manager or business.','Veuillez choisir résidence, entrepreneur, gestionnaire immobilier ou entreprise.']
 };
 function language(lang){return lang==='fr'?1:0;}
 function detectType(value){const s=value.toLowerCase();if(/contractor|entrepreneur|builder|chantier/.test(s))return 'contractor';if(/property|gestionnaire|immeuble/.test(s))return 'property';if(/business|commercial|entreprise|commerce/.test(s))return 'commercial';if(/home|personal|personnel|résiden|particulier|propriétaire|maison/.test(s))return 'homeowner';return null;}
 function classify(value){const s=value.toLowerCase();if(/cancel|annul/.test(s))return 'cancel';if(/resched|report|déplac.*rendez|change.*appointment/.test(s))return 'reschedule';if(/\bowner\b|\bhuman\b|speak to|parler.*propriétaire|humain|rappel|callback/.test(s))return 'callback';if(/spam|sales call|selling|sollicitation|pourriel|vendre/.test(s))return 'filtered';return 'service';}
 function newCall(settings={}){return {id:'demo-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString(),business:settings.business||'CallPilot demo',action:'service',type:null,values:{},flags:[],transcript:[],status:'pending',assignedTo:'',calendar:settings.calendar||'request',settings};}
 function next(call){const v=call.values;if(!v.issue)return 'issue';if(['callback','filtered'].includes(call.action))return ['name','phone','reason'].find(k=>!v[k])||null;if(['cancel','reschedule'].includes(call.action)){const queue=['name','phone','original',...(call.action==='reschedule'?['date','time']:[]),'reason'];return queue.find(k=>!v[k])||null;}if(!call.type)return 'type';const queue=['scope','name',...(call.type!=='homeowner'?['company','role']:[]),'city','address',...(call.type==='property'?['property','unit']:[]),'safety','urgency',...(call.type==='commercial'?['impact']:[]),'access',...(call.type==='property'||call.type==='contractor'?['authorization']:[]),...(v.urgent?['dispatch']:['date','time']),'phone',...(call.type==='contractor'?['po']:[])];return queue.find(k=>!v[k])||null;}
 function answer(call,field,text){text=String(text||'').trim();if(!text)return 'empty';if(field==='type'){const type=detectType(text);if(!type)return 'unknownType';call.type=type;}else if(field==='phone'){const digits=text.replace(/\D/g,'');if(!/^(1)?\d{10}$/.test(digits))return 'invalidPhone';call.values.phone=digits;}else if(field==='address'){if(!/\d/.test(text)||!/[A-Za-zÀ-ÿ]/.test(text))return 'invalidAddress';call.values.address=text;}else call.values[field]=text;
 if(field==='issue'){call.action=classify(text);if(call.action==='service'&&!/^(service request|demande de service)$/i.test(text))call.values.scope=text;}
 if(field==='safety' && !/^(no\b|non\b|none\b|aucun)/i.test(text) && /yes|oui|fire|smoke|gas|spark|danger|incend|fumée|gaz|étincelle/i.test(text)){call.flags.push('danger');call.action='callback';}
 if(field==='urgency')call.values.urgent=!/^(no\b|non\b|regular|réguli|not)/i.test(text)&&/urgent|emergency|urgence|today|aujourd/i.test(text);
 if(field==='city' && call.settings.areas?.length && !call.settings.areas.some(a=>a.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase()===text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase()))call.flags.push('outside-area');
 return null;}
 return {fields,messages,language,detectType,classify,newCall,next,answer,REQUEST_KEY:'callpilot.demo.requests.v2',SETTINGS_KEY:'callpilot.demo.settings.v2'};
});
