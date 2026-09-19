import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_panel/src/core/proxy_input_parser.dart';

void main() {
  test('imports an authenticated Geonix export line', () {
    final proxy = parseProxyInput(
      'IP 192.0.2.10:59101; LOGIN: cliente | PASSWORD: segredo;',
    );
    expect(proxy.host, '192.0.2.10');
    expect(proxy.port, 59101);
    expect(proxy.username, 'cliente');
    expect(proxy.password, 'segredo');
  });

  test('imports encoded credentials and IPv6 from a URL', () {
    final proxy = parseProxyInput('socks5h://user:p%40ss@[2001:db8::1]:59101');
    expect(proxy.protocol, 'socks5h');
    expect(proxy.host, '2001:db8::1');
    expect(proxy.password, 'p@ss');
  });

  test('imports host:port:user:password and rejects unsafe URLs', () {
    final proxy = parseProxyInput('proxy.example:59100:user:long:pass');
    expect(proxy.password, 'long:pass');
    expect(
      () => parseProxyInput('file://user:pass@host:80'),
      throwsFormatException,
    );
    expect(() => parseProxyInput('host:59100/path'), throwsFormatException);
    expect(() => parseProxyInput('host:0'), throwsFormatException);
  });
}
