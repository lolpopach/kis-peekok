#!/usr/bin/perl
# 피콕 로봇 시험 바로 실행 (업로드 없음): 보드에 시험 명령을 보내고 시리얼을 보여 준다.
#   run        분기 시험 (j): 한쪽 분기 → 그쪽으로 회전, 양쪽이면 멈춤
#   run k      순서 코스 시험
#   run j      분기 시험 · run h 멈춤 시험 · run t 선 따라가기 시험 · run s 센서 보기
#   run v      분기 시험 + 0.1초마다 센서·바퀴 기록
#   run -      아무 시험도 안 하고 시리얼만 보기
#   run w ...  USB 가 꽂혀 있어도 WiFi 로 (USB 가 없으면 자동으로 WiFi)
# 실행 중에 글자를 치고 엔터: 그대로 보드에 보냄 (예: x 멈춤 · PuPwm=130 설정 바꾸기 · P 설정 목록)
# 그냥 엔터 또는 Ctrl+C: 로봇 멈춤(x) 후 끝냄
use strict;
use warnings;
use IO::Select;

my $wifi = 0;
if (@ARGV && $ARGV[0] eq 'w') { $wifi = 1; shift; }
my $mode = shift // 'j';
my $verbose = 0;
if ($mode eq 'v') { $mode = 'j'; $verbose = 1; }

# USB 로 꽂혀 있으면 USB, 아니면 WiFi(peekok-robot.local:2323 · ROBOT_HOST 로 바꿀 수 있음). run w ... 는 늘 WiFi
opendir(my $d, "/dev") or die;
my ($port) = sort grep { /^cu\.(usbserial|wchusbserial|SLAB)/ } readdir($d);
closedir($d);
my $f;
if ($port && !$wifi) {
  $port = "/dev/$port";
  open($f, "+<", $port) or die "$port 를 열 수 없어요 (다른 창에서 시리얼 모니터나 Claude 가 쓰는 중이면 닫아 주세요): $!\n";
  system("stty -f $port 115200 raw -echo");
} else {
  require IO::Socket::INET;
  my $host = $ENV{ROBOT_HOST} // 'peekok-robot.local';
  print "[WiFi 로 연결 중: $host:2323]\n";
  $f = IO::Socket::INET->new(PeerAddr => $host, PeerPort => 2323, Proto => 'tcp', Timeout => 5)
    or die "로봇에 WiFi 로 연결하지 못했어요 ($host) — 로봇과 Mac 이 같은 WiFi 인지, 로봇이 켜져 있는지 확인하세요\n";
  $f->autoflush(1);
  $port = "WiFi $host";
}
$| = 1;

my $stop = sub {
  syswrite($f, "x");
  select(undef, undef, undef, 0.3);
  print "\n[로봇 멈춤 보냄 — 끝]\n";
  exit 0;
};
$SIG{INT} = $stop;

print "[$port 연결] 2초 뒤 시작 · 글자+엔터 = 보드로 보내기 · 그냥 엔터나 Ctrl+C = 멈추고 끝\n";
my $sel = IO::Select->new($f, \*STDIN);
my $t0 = time;
my $started = 0;
while (1) {
  for my $h ($sel->can_read(0.1)) {
    if ($h == $f) {
      my $n = sysread($f, my $buf, 4096);
      if (!$n) { print "\n[USB 연결 끊김]\n"; exit 1; }
      print $buf;
    } else {
      my $line = <STDIN>;
      $stop->() unless defined $line;
      chomp $line;
      $stop->() if $line eq '';
      syswrite($f, $line . "\n");
    }
  }
  if (!$started && time - $t0 >= 2) {
    $started = 1;
    next if $mode eq '-';
    syswrite($f, "x"); select(undef, undef, undef, 0.4);
    if ($verbose) { syswrite($f, "v"); select(undef, undef, undef, 0.4); }
    syswrite($f, $mode);
  }
}
