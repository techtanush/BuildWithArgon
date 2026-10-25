// @vitest-environment jsdom
import {afterEach,it,expect,vi} from "vitest";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {WorkplacePanel} from "../../../src/world/hud/WorkplacePanel";
import {Hud} from "../../../src/world/hud/Hud";
import {Engine,initialWorldState} from "../../../src/world/engine/Engine";
import {Vector3} from "three";
let root:Root|undefined;let host:HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.unstubAllGlobals();});
function mount(node:React.ReactNode){host=document.createElement("div");document.body.append(host);root=createRoot(host);act(()=>root!.render(node));}
it("mock readiness never fetches or fabricates communications",()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const close=vi.fn();mount(<WorkplacePanel ventureId="v" departmentId="engineering" name="Engineering" mock activity={null} activityError={null} onClose={close}/>);
 expect(host.textContent).toContain("Live communications and activity are disabled");expect(fetcher).not.toHaveBeenCalled();expect(document.activeElement?.getAttribute("aria-label")).toBe("Close workplace");act(()=>host.querySelector("button")!.click());expect(close).toHaveBeenCalled();
});
it("HUD exposes real workspace and department-lead directory actions",()=>{
 const openWorkplace=vi.fn(),meetDepartmentLeads=vi.fn();mount(<Hud state={{...initialWorldState,ready:true,mode:"foot",scene:"interior:engineering"}} engine={{openWorkplace,meetDepartmentLeads} as unknown as Engine}/>);
 act(()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="See communications")!.click());expect(openWorkplace).toHaveBeenCalled();
 act(()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Meet department leads")!.click());expect(meetDepartmentLeads).toHaveBeenCalled();
});
it("E and other world actions cannot fire through workspace modal",()=>{
 const closeWorkplace=vi.fn(),interact=vi.fn();const context={state:{ready:true,mode:"workplace"},closeWorkplace,interact};
 (Engine.prototype as any).onKey.call(context,"KeyE",true);expect(interact).not.toHaveBeenCalled();(Engine.prototype as any).onKey.call(context,"Escape",true);expect(closeWorkplace).toHaveBeenCalled();
});
it("parked car entry requires walking nearby and never enters from a menu",()=>{
 const toast=vi.fn(),close=vi.fn();const context={interior:null,state:{mode:"foot"},player:{position:new Vector3(20,1.65,0)},car:{group:{position:new Vector3()}},toast,conversation:{close}};
 Engine.prototype.enterCar.call(context as any);expect(toast).toHaveBeenCalledWith(expect.stringContaining("Walk up"));expect(close).not.toHaveBeenCalled();context.state.mode="workplace";context.player.position.set(0,1.65,0);Engine.prototype.enterCar.call(context as any);expect(close).not.toHaveBeenCalled();
});
