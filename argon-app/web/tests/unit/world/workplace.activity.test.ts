import {afterEach,describe,it,expect,vi} from "vitest";
import {poll,readPage,safeWorldLink} from "../../../src/world/activity/network";
import {CompletionTracker,loadCommunications,scopeActivity,chatLink,type Run} from "../../../src/world/activity/workplace";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const channel={id:"chn_eng",slug:"engineering",name:"Engineering",department_id:"engineering",kind:"department"};
const run=(status:string,id="run_1",completed_at:string|null=null):Run=>({id,status,completed_at,kind:"build",job:"Actual build",agent_id:"eng.builder",ticket_id:null});
describe("read-only workplace data",()=>{
 it("discovers only venture + department channels before fetching actual messages",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{items:[channel,{...channel,id:"other",department_id:"sales"}]}}))).mockResolvedValueOnce(new Response(JSON.stringify({data:{items:[{id:"m",channel_id:"chn_eng",body:"Real recorded text"},{id:"bad",channel_id:"other"}]}})));
  vi.stubGlobal("fetch",fetcher);const signal=new AbortController().signal;
  const data=await loadCommunications("ven/x","engineering","other",signal);
  expect(data.channel?.id).toBe("chn_eng");expect(data.messages.map(m=>m.id)).toEqual(["m"]);
  expect(fetcher).toHaveBeenNthCalledWith(1,"/v1/ventures/ven%2Fx/channels",{method:"GET",signal});
  expect(fetcher).toHaveBeenNthCalledWith(2,"/v1/channels/chn_eng/messages?limit=50",{method:"GET",signal});
  expect(chatLink("v",channel)).toBe("/chat/engineering?venture=v&channel=chn_eng");
 });
 it("does not invent a channel or request messages when no channel matches",async()=>{
  const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{items:[]}})));vi.stubGlobal("fetch",f);
  expect(await loadCommunications("v","engineering",null,new AbortController().signal)).toEqual({channels:[],channel:null,messages:[]});expect(f).toHaveBeenCalledTimes(1);
 });
 it("fails closed on bad envelopes and unavailable backend",async()=>{
  for(const r of [new Response("{}"),new Response("{}",{status:503})]){vi.stubGlobal("fetch",vi.fn().mockResolvedValue(r));await expect(readPage("/v1/x",new AbortController().signal)).rejects.toThrow();}
 });
 it("baseline history is silent; subsequent terminal transitions notify once",()=>{
  const tracker=new CompletionTracker();expect(tracker.observe([run("succeeded","old"),run("running")])).toEqual([]);
  expect(tracker.observe([run("succeeded","old"),run("succeeded")])).toHaveLength(1);
  expect(tracker.observe([run("succeeded")])).toEqual([]);
  expect(tracker.observe([run("succeeded","historic","2000-01-01T00:00:00Z")])).toEqual([]);
 });
 it("scopes runs by real department agent/ticket relations",()=>{
  const scoped=scopeActivity({agents:[{id:"eng.builder",department_id:"engineering",display_name:"Builder",state:{status:"working"}}],tickets:[],runs:[run("running"),{...run("running","other"),agent_id:"sales"}],artifacts:[]},"engineering");expect(scoped.runs.map(r=>r.id)).toEqual(["run_1"]);
 });
 it("allows HTTP previews and relative artifact paths, never executable URLs",()=>{
  for(const url of ["javascript:alert(1)","data:text/html,hello","//evil.test","/\\evil.test"," https://bad.test"] )expect(safeWorldLink(url)).toBeNull();
  expect(safeWorldLink("/preview/real")).toBe("/preview/real");expect(safeWorldLink("https://example.com/build")).toBe("https://example.com/build");
 });
 it("polls serially at bounded cadence and aborts on cleanup",async()=>{
  vi.useFakeTimers();let signal:AbortSignal|undefined;
  const read=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<string>(()=>{});});const accept=vi.fn();const stop=poll(read,accept,vi.fn(),1);
  await vi.advanceTimersByTimeAsync(11000);expect(read).toHaveBeenCalledTimes(1);stop();expect(signal?.aborted).toBe(true);await vi.advanceTimersByTimeAsync(50000);expect(read).toHaveBeenCalledTimes(1);expect(accept).not.toHaveBeenCalled();
 });
});
