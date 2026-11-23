# 로봇 무선 기록 보기·명령 보내기 (Claude 가 쓰는 시험 도구, 추가 설치 없음 — Mac·Windows Git Bash 둘 다)
#   perl watch.pl <총초> [<초>:<글자> ...]
#   예) perl watch.pl 30 1:x 2:v 3:GuE   → 1초에 x(멈춤), 2초에 v(주행 기록 켜기), 3초에 GuE(제자리 유턴 후 다음 갈림길까지)
# 로봇 주소: ROBOT_HOST (기본 peekok-robot.local — Windows 에서 .local 이 안 찾아지면 IP 로)
# 끝날 때 x(멈춤)를 보냄. 로봇 시리얼은 한 번에 한 연결만 → run·지도 프로그램과 동시에 쓰면 서로 끊김
use strict; use warnings; use IO::Socket::INET;
my ($total, @cmds) = @ARGV;
die "사용: perl watch.pl <총초> [<초>:<글자> ...]\n" unless $total;
my $host = $ENV{ROBOT_HOST} || 'peekok-robot.local';
my $s = IO::Socket::INET->new(PeerAddr => $host, PeerPort => 2323, Proto => 'tcp', Timeout => 5)
  or die "WiFi 연결 실패 ($host) — 로봇이 켜져 있고 같은 WiFi 인지, 안 되면 ROBOT_HOST=<IP>\n";
$s->autoflush(1); $| = 1;
my @c = map { [split /:/, $_, 2] } @cmds;
my $t0 = time; my $b;
while (time - $t0 < $total) {
  my $rin = ''; vec($rin, fileno($s), 1) = 1;
  if (select($rin, undef, undef, 0.1)) {
    my $n = sysread($s, $b, 4096);
    if (!$n) { print "\n[WiFi 연결 끊김]\n"; exit 1; }
    print $b;
  }
  while (@c && time - $t0 >= $c[0][0]) { my $x = shift @c; print "\n>>> 보냄: $x->[1]\n"; syswrite($s, $x->[1]); }
}
syswrite($s, 'x');
