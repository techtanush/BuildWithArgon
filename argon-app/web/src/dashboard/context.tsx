// OWNER: tanush
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { get } from "../api/client";
import { invalidateQueries, patchQuery, useQuery } from "../api/hooks";
import { subscribe, subscribeStatus, type StreamStatus } from "../api/sse";
import type { ListPage, SseEvent, Venture } from "../shared/contracts";
import type { SystemStatus } from "./types";
interface CompanyContext {
  ventureId: string | null;
  venture?: Venture;
  ventures: Venture[];
  loading: boolean;
  error: Error | null;
  selectVenture: (id: string) => void;
  system?: SystemStatus;
  live: StreamStatus;
  refresh: () => void;
}
const Context = createContext<CompanyContext | null>(null);
export function CompanyProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem("foundry.venture");
    } catch {
      return null;
    }
  });
  const list = useQuery<ListPage<Venture>>("/v1/ventures", () =>
    get("/v1/ventures"),
  );
  const available = list.data?.items ?? [];
  const ventureId = available.some((v) => v.id === selected)
    ? selected
    : (available[0]?.id ?? null);
  const detail = useQuery<Venture>(
    ventureId ? `/v1/ventures/${ventureId}` : null,
    () => get(`/v1/ventures/${ventureId}`),
  );
  const system = useQuery<SystemStatus>("/v1/system/status", () =>
    get("/v1/system/status"),
  );
  const [live, setLive] = useState<StreamStatus>("connecting");
  function selectVenture(id: string) {
    setSelected(id);
    try {
      localStorage.setItem("foundry.venture", id);
    } catch {
      /* Storage can be disabled. */
    }
  }
  useEffect(() => {
    if (ventureId && ventureId !== selected) selectVenture(ventureId);
  }, [ventureId]);
  useEffect(() => {
    if (!ventureId) return;
    const status = subscribeStatus(ventureId, (value) => {
      setLive(value);
      if (value === "live") invalidateQueries();
    });
    const update = subscribe(ventureId, (event: SseEvent) => {
      if (event.type === "venture.updated")
        patchQuery<Venture>(`/v1/ventures/${ventureId}`, (previous) => ({
          ...previous,
          ...(event.data as Venture),
        }));
      invalidateQueries(`/v1/ventures/${ventureId}`);
      if (event.type.startsWith("ticket.")) invalidateQueries("/v1/tickets/");
      if (event.type.startsWith("run.")) invalidateQueries("/v1/runs/");
      if (event.type === "message.posted") invalidateQueries("/v1/channels/");
      if (event.type.startsWith("approval."))
        invalidateQueries("/v1/approvals/");
      if (event.type.startsWith("worldgen."))
        invalidateQueries("/v1/world/worldgen/");
      if(event.type.startsWith('computer.'))invalidateQueries('/v1/computer-tasks/');
    });
    return () => {
      update();
      status();
    };
  }, [ventureId]);
  return (
    <Context.Provider
      value={{
        ventureId,
        venture: detail.data ?? available.find((v) => v.id === ventureId),
        ventures: available,
        loading: list.loading,
        error: list.error,
        selectVenture,
        system: system.data,
        live,
        refresh: () => {
          invalidateQueries();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCompany() {
  const value = useContext(Context);
  if (!value) throw new Error("Company context missing");
  return value;
}
