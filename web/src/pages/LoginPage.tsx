import { Button, Card, CardBody, CardTitle } from "@team-carol/design-system/react";

export function LoginPage() {
  return (
    <main className="login">
      <Card className="login__card">
        <img src="/icon.svg" alt="" width={48} height={48} />
        <CardTitle>carol live</CardTitle>
        <CardBody>마이마이 방송 녹화본을 보고, 원하는 구간만 잘라서 받는 곳. 팀 캐롤 멤버만 들어올 수 있음.</CardBody>
        <Button variant="primary" size="lg" href="/auth/login" className="login__button">
          디스코드로 로그인
        </Button>
      </Card>
    </main>
  );
}
