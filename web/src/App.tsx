import { useEffect, useState } from "react";
import { Brand, Button, Footer, TopBar, TopBarLink } from "@team-carol/design-system/react";
import { api, ApiError, type Me } from "./api";
import { link, useRoute } from "./router";
import { LoginPage } from "./pages/LoginPage";
import { DrivePage } from "./pages/DrivePage";
import { EditorPage } from "./pages/EditorPage";
import { DevicesPage } from "./pages/DevicesPage";

export function App() {
  const route = useRoute();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setError(String(e.message ?? e))));
  }, []);

  if (error) {
    return (
      <main className="crl-container page">
        <p className="crl-helper crl-helper--error">{error}</p>
      </main>
    );
  }
  if (me === undefined) return <main className="crl-container page caption-muted">불러오는 중…</main>;
  if (me === null) return <LoginPage />;

  const logout = async () => {
    await api.logout();
    setMe(null);
  };

  return (
    <>
      <TopBar brand={<Brand name="carol live" markSrc="/icon.svg" {...link("/")} />}>
        <TopBarLink {...link("/")} active={route.name !== "devices"}>
          녹화
        </TopBarLink>
        <TopBarLink {...link("/devices")} active={route.name === "devices"}>
          기기
        </TopBarLink>
        <span className="topbar-user">
          {me.avatar ? <img src={me.avatar} alt="" width={24} height={24} /> : null}
          {me.name}
        </span>
        <Button variant="secondary" size="sm" onClick={logout}>
          로그아웃
        </Button>
      </TopBar>
      <main className={route.name === "recordings" || route.name === "folder" ? "page page--drive" : "crl-container page"}>
        {(route.name === "recordings" || route.name === "folder") && <DrivePage route={route} />}
        {route.name === "editor" && <EditorPage id={route.id} />}
        {route.name === "devices" && <DevicesPage />}
      </main>
      <Footer>
        <span className="crl-caption">carol live · team carol</span>
      </Footer>
    </>
  );
}
