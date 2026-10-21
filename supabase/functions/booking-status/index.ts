// Public read-only booking status endpoint. The appointment UUID and matching email are required.
// Deploy via Supabase Dashboard, set Verify JWT OFF. Never expose service role key in the browser.
import { createClient } from "npm:@supabase/supabase-js@2";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"https://hair-by-lynna.pages.dev","Vary":"Origin"}});
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"https://hair-by-lynna.pages.dev","Access-Control-Allow-Headers":"content-type,apikey,authorization,x-client-info,x-supabase-api-version","Access-Control-Allow-Methods":"POST,OPTIONS"}});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 let body:{id?:unknown;email?:unknown};
 try{body=await req.json()}catch{return json({error:"Invalid request"},400)}
 const id=typeof body.id==="string"?body.id.trim():"";
 const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
 if(!idPattern.test(id)||email.length>254||!/^\S+@\S+\.\S+$/.test(email))return json({error:"Check booking link and email"},400);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({error:"Temporarily unavailable"},503);
 const db=createClient(url,key,{auth:{persistSession:false}});
 const {data,error}=await db.from("appointments").select("id,customer_email,starts_at,ends_at,status,services(name_en,name_fr)").eq("id",id).maybeSingle();
 if(error){console.error("booking-status lookup failed",error.code);return json({error:"Temporarily unavailable"},503)}
 if(!data||data.customer_email?.trim().toLowerCase()!==email)return json({error:"Booking not found. Check the email used when booking."},404);
 const service=Array.isArray(data.services)?data.services[0]:data.services;
 return json({id:data.id,status:data.status,starts_at:data.starts_at,ends_at:data.ends_at,service_en:service?.name_en||"",service_fr:service?.name_fr||""});
});
