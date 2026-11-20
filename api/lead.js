'use strict';
const { randomUUID } = require('node:crypto');

// Revival Funnel intake, separate from the original Ignite growth funnel.
// The server decides eligibility and offer routing. Never trust client-provided routing.
const answers = {
  monthly_revenue: ['under_15k','15k_30k','30k_60k','60k_100k','100k_plus'],
  old_leads: ['under_50','50_100','100_250','250_500','500_plus'],
  average_job_size: ['under_5k','5k_10k','10k_25k','25k_plus'],
  monthly_marketing_budget: ['under_500','500_1k','1k_2_5k','2_5k_plus'],
  decision_maker: ['yes','with_partner','no'],
  start_timing: ['this_month','next_60_days','researching'],
  lead_contact_permission: ['most','some','not_sure'],
  lead_storage: ['phone','crm','spreadsheet','paper']
};
const labels = {
  monthly_revenue: {under_15k:'Under $15K','15k_30k':'$15K–$30K','30k_60k':'$30K–$60K','60k_100k':'$60K–$100K','100k_plus':'$100K+'},
  old_leads: {under_50:'Under 50','50_100':'50–100','100_250':'100–250','250_500':'250–500','500_plus':'500+'},
  average_job_size: {under_5k:'Under $5K','5k_10k':'$5K–$10K','10k_25k':'$10K–$25K','25k_plus':'$25K+'},
  monthly_marketing_budget: {under_500:'Under $500','500_1k':'$500–$1K','1k_2_5k':'$1K–$2.5K','2_5k_plus':'$2.5K+'},
  decision_maker: {yes:'Yes',with_partner:'Yes, with a partner',no:'No'},
  start_timing: {this_month:'This month',next_60_days:'Next 60 days',researching:'Just researching'},
  lead_contact_permission: {most:'Yes, most',some:'Some',not_sure:'Not sure'},
  lead_storage: {phone:'Phone',crm:'CRM',spreadsheet:'Spreadsheet',paper:'Paper'}
};
const answersV2 = {"old_leads":["under_50","50_100","100_250","250_plus"],"average_job_size":["under_5k","5k_15k","15k_30k","30k_plus"],"lead_storage":["crm","spreadsheet","phone","email","not_sure"],"start_timing":["right_away","next_30_days","researching"]};
const labelsV2 = {"old_leads":{"under_50":"Under 50","50_100":"50-100","100_250":"100-250","250_plus":"250+"},"average_job_size":{"under_5k":"Under $5K","5k_15k":"$5-15K","15k_30k":"$15-30K","30k_plus":"$30K+"},"lead_storage":{"crm":"CRM like GHL or Jobber","spreadsheet":"Spreadsheet","phone":"Phone or texts","email":"Email","not_sure":"Not sure"},"start_timing":{"right_away":"Right away","next_30_days":"In the next 30 days","researching":"Just looking for now"}};
function text(value,max){return typeof value === 'string'?value.trim().slice(0,max):'';}
function valid(value,min,max){return typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max;}
function respond(res,status,data){res.setHeader('Cache-Control','no-store');return res.status(status).json(data);}
function determineRoute(data){
  if(data.funnel_version==='revival_v2'){
    if(data.average_job_size==='under_5k')return 'disqualified';
    if(data.start_timing==='researching')return 'nurture';
    if(['under_50','50_100'].includes(data.old_leads))return '90_day_system';
    if(data.average_job_size==='5k_15k')return 'manual_review';
    return 'revival_997';
  }
  if(['under_15k','15k_30k'].includes(data.monthly_revenue) ||
    data.average_job_size==='under_5k' ||
    data.monthly_marketing_budget==='under_500' ||
    data.decision_maker==='no')return 'disqualified';
  if(data.start_timing==='researching')return 'nurture';
  if(['under_50','50_100'].includes(data.old_leads))return '90_day_system';
  if(data.average_job_size==='5k_10k')return 'manual_review';
  return 'revival_997';
}
module.exports=async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return respond(res,405,{error:'Method not allowed'});}
  if(!String(req.headers['content-type']||'').includes('application/json'))return respond(res,415,{error:'Use JSON'});
  if(Number(req.headers['content-length']||0)>12000)return respond(res,413,{error:'Request is too large'});
  let data=req.body;
  if(typeof data==='string'){try{data=JSON.parse(data);}catch{return respond(res,400,{error:'Invalid request'});}}
  if(!data||typeof data!=='object'||Array.isArray(data))return respond(res,400,{error:'Invalid request'});
  if(data.other_field)return respond(res,201,{ok:true});
  if(!['revival_v1','revival_v2'].includes(data.funnel_version))return respond(res,400,{error:'Unrecognized application version'});
  const isV2=data.funnel_version==='revival_v2';
  const activeAnswers=isV2?answersV2:answers;
  const activeLabels=isV2?labelsV2:labels;
  for(const [key,allowed] of Object.entries(activeAnswers)){
    if(!allowed.includes(data[key]))return respond(res,400,{error:'Please complete all qualification questions',field:key});
  }
  if(!isV2&&!valid(data.growth_blocker,3,1500))return respond(res,400,{error:'Please describe what is holding your growth back',field:'growth_blocker'});
  const fullName=text(data.name,160).replace(/\s+/g,' ');
  const nameParts=fullName.split(' ');
  const firstName=nameParts.shift()||'';
  const lastName=nameParts.join(' ');
  if(!valid(firstName,1,80)||!valid(lastName,0,80)||!valid(data.business_name,2,150))return respond(res,400,{error:'Please provide valid contact details'});
  if(!valid(data.email,5,200)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()))return respond(res,400,{error:'Please enter a valid email address'});
  const digits=text(data.phone,30).replace(/\D/g,'');
  const national=digits.length===11&&digits.startsWith('1')?digits.slice(1):digits;
  if(!/^\d{10}$/.test(national))return respond(res,400,{error:'Please provide a valid 10-digit US phone number'});
  if(data.consent!==true)return respond(res,400,{error:'Contact permission is required'});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key){console.error('Revival funnel Supabase configuration missing');return respond(res,503,{error:'Application service unavailable'});}
  const edit=Boolean(data.submission_id||data.edit_token);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(edit&&(!uuid.test(data.submission_id||'')||!uuid.test(data.edit_token||'')))return respond(res,400,{error:'Invalid edit session'});
  const submissionId=edit?data.submission_id:randomUUID();
  const editToken=edit?data.edit_token:randomUUID();
  const route=determineRoute(data);
  const record={
    first_name:firstName,last_name:lastName||null,business_name:text(data.business_name,150),
    email:text(data.email,200).toLowerCase(),phone:'+1'+national,
    monthly_revenue:isV2?null:data.monthly_revenue,old_leads:data.old_leads,average_job_size:data.average_job_size,
    monthly_marketing_budget:isV2?null:data.monthly_marketing_budget,decision_maker:isV2?null:data.decision_maker,
    start_timing:data.start_timing,lead_contact_permission:isV2?null:data.lead_contact_permission,
    lead_storage:data.lead_storage,growth_blocker:isV2?null:text(data.growth_blocker,1500),
    consent:true,source:'revival_funnel',
    utm_source:text(data.utm_source,100)||null,
    utm_medium:text(data.utm_medium,100)||null,
    utm_campaign:text(data.utm_campaign,100)||null
  };
  const endpoint=url.replace(/\/$/,'')+(edit?'/rest/v1/rpc/update_revival_funnel_application':'/rest/v1/revival_funnel_leads');
  const headers={'Content-Type':'application/json','apikey':key,'Prefer':'return=minimal'};
  if(!key.startsWith('sb_publishable_'))headers.Authorization='Bearer '+key;
  try {
    const db=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(edit?{p_id:submissionId,p_token:editToken,p_data:record}:{...record,id:submissionId,edit_token:editToken}),signal:AbortSignal.timeout(9000)});
    if(!db.ok){console.error('Revival funnel insert/update returned',db.status);return respond(res,502,{error:'Could not save application right now'});}
    if(edit&&(await db.text()).trim()!=='true')return respond(res,409,{error:'Your editing session expired. Please refresh to submit again.'});
    const webhookUrl=process.env.GHL_LEAD_WEBHOOK_URL;
    if(webhookUrl){
      const hookPayload={
        event_type:edit?'revival_application_updated':'revival_application_submitted',
        source:'Ignite Revival Funnel',funnel_version:'revival_v1',quiz_version:data.funnel_version,submission_id:submissionId,
        first_name:firstName,last_name:lastName||null,name:fullName,
        business_name:record.business_name,company_name:record.business_name,
        email:record.email,phone:record.phone,
        ...Object.fromEntries(Object.keys(answers).flatMap(field=>[[field,record[field]],[field+'_text',activeLabels[field]?.[record[field]]??null]])),
        growth_blocker:record.growth_blocker,
        offer_route:route,lead_segment:route,qualified_for_call:['90_day_system','revival_997'].includes(route),
        partner_required:!isV2&&data.decision_maker==='with_partner',
        manual_review_required:route==='manual_review',
        nurture_only:route==='nurture',
        disqualified:route==='disqualified',
        consent:true,
        // Consent to contact the applicant is not proof that their old contacts opted into outreach.
        old_list_permission_review_required:isV2||data.lead_contact_permission!=='most',
        verify_individual_outreach_consent_before_reactivation:true,
        utm_source:record.utm_source,utm_medium:record.utm_medium,utm_campaign:record.utm_campaign
      };
      try{
        const delivery=await fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(hookPayload),signal:AbortSignal.timeout(6000)});
        if(!delivery.ok)console.error('Revival GHL webhook returned',delivery.status);
      }catch(e){console.error('Revival GHL webhook failure',e?.name||'UnknownError');}
    }else console.error('Revival GHL webhook not configured');
    return respond(res,edit?200:201,{ok:true,submission_id:submissionId,edit_token:editToken,offer_route:route,partner_required:!isV2&&data.decision_maker==='with_partner'});
  }catch(e){console.error('Revival submission error',e?.name||'UnknownError');return respond(res,503,{error:'Could not save application right now'});}
};
