// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {runningDepartmentAgents} from '../../../src/world/hud/DepartmentGroupChat';
import {departmentChannels, type Activity} from '../../../src/world/activity/workplace';
it('only reports actual running jobs for agents in the entered department',()=>{
 const activity={agents:[{id:'eng',department_id:'engineering'},{id:'sales',department_id:'sales'}],tickets:[],artifacts:[],runs:[{id:'r1',agent_id:'eng',status:'running',model:'recorded-model'},{id:'r2',agent_id:'eng',status:'succeeded'},{id:'r3',agent_id:'eng',status:'queued'},{id:'r4',agent_id:'sales',status:'running'},{id:'tutor',agent_id:'eng',status:'running',job:'starter_tutor'}]} as unknown as Activity;
 expect(runningDepartmentAgents(activity,'engineering').map(r=>r.id)).toEqual(['r1']);
 expect(runningDepartmentAgents(null,'engineering')).toEqual([]);
});
it('uses real channel IDs from matching department metadata or slug',()=>{
 const channels=[{id:'actual-id',department_id:null,slug:'engineering'},{id:'growth-id',department_id:'growth',slug:'growth'},{id:'unrelated',department_id:'sales',slug:'sales'}] as any;
 expect(departmentChannels(channels,'engineering').map(c=>c.id)).toEqual(['actual-id']);
 expect(departmentChannels(channels,'growth').map(c=>c.id)).toEqual(['growth-id']);
});
