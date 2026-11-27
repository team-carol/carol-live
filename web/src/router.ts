import { useEffect, useState } from "react";

/** tiny pathname router: "/", "/recent", "/folder/:device", "/r/:id", "/devices", "/maimai", "/import" */
export type Route =
  | { name: "recordings"; view: "all" | "recent" }
  | { name: "folder"; device: string }
  | { name: "editor"; id: string }
  | { name: "devices" }
  | { name: "maimai" }
  | { name: "import" };

function parse(path: string): Route {
  const editor = /^\/r\/([^/]+)$/.exec(path);
  if (editor) return { name: "editor", id: decodeURIComponent(editor[1]) };
  const folder = /^\/folder\/([^/]+)$/.exec(path);
  if (folder) return { name: "folder", device: decodeURIComponent(folder[1]) };
  if (path === "/devices") return { name: "devices" };
  if (path === "/maimai") return { name: "maimai" };
  if (path === "/import") return { name: "import" };
  if (path === "/recent") return { name: "recordings", view: "recent" };
  return { name: "recordings", view: "all" };
}

export const folderPath = (device: string) => `/folder/${encodeURIComponent(device)}`;

export function navigate(path: string) {
  if (location.pathname !== path) history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}

/** onClick for <a href> that keeps navigation inside the SPA */
export function link(path: string) {
  return {
    href: path,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(path);
    },
  };
}
