class ParsedProxyInput {
  const ParsedProxyInput({
    required this.protocol,
    required this.host,
    required this.port,
    this.username = '',
    this.password = '',
  });

  final String protocol;
  final String host;
  final int port;
  final String username;
  final String password;
}

/// Accepts a provider URL, host:port:user:password or Geonix export line.
/// Parsing happens on the device; credentials are not sent until Test/Save.
ParsedProxyInput parseProxyInput(String input, {String protocol = 'socks5'}) {
  final raw = input.trim();
  if (raw.isEmpty || raw.contains('\n')) {
    throw const FormatException('Cole os dados de um único proxy.');
  }
  const schemes = {'http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h'};
  if (!schemes.contains(protocol)) {
    throw const FormatException('Protocolo de proxy inválido.');
  }

  final geonix = RegExp(
    r'^\s*(?:IP\s*)?(\[[^\]]+\]|[^\s:;]+):(\d+)\s*;\s*LOGIN\s*:\s*([^|;]+)\s*\|\s*PASSWORD\s*:\s*([^;]+)\s*;?\s*$',
    caseSensitive: false,
  ).firstMatch(raw);
  if (geonix != null) {
    return _parsed(
      protocol,
      geonix.group(1)!,
      geonix.group(2)!,
      geonix.group(3)!.trim(),
      geonix.group(4)!.trim(),
    );
  }

  final hostFirst = RegExp(
    r'^(\[[^\]]+\]|[^:@\s]+):(\d+):([^:\s]+):(.+)$',
  ).firstMatch(raw);
  if (hostFirst != null) {
    return _parsed(
      protocol,
      hostFirst.group(1)!,
      hostFirst.group(2)!,
      hostFirst.group(3)!,
      hostFirst.group(4)!,
    );
  }

  final url = Uri.tryParse(raw.contains('://') ? raw : '$protocol://$raw');
  if (url == null ||
      !schemes.contains(url.scheme) ||
      url.host.isEmpty ||
      !url.hasPort ||
      url.port < 1 ||
      url.port > 65535 ||
      url.path.isNotEmpty ||
      url.hasQuery ||
      url.hasFragment) {
    throw const FormatException(
      'Formato inválido. Use protocolo://usuário:senha@host:porta ou host:porta:usuário:senha.',
    );
  }
  final split = url.userInfo.indexOf(':');
  final user = split < 0 ? url.userInfo : url.userInfo.substring(0, split);
  final password = split < 0 ? '' : url.userInfo.substring(split + 1);
  return _parsed(
    url.scheme,
    url.host,
    url.port.toString(),
    Uri.decodeComponent(user),
    Uri.decodeComponent(password),
  );
}

ParsedProxyInput _parsed(
  String protocol,
  String host,
  String port,
  String username,
  String password,
) {
  final number = int.tryParse(port);
  if (number == null ||
      number < 1 ||
      number > 65535 ||
      host.trim().isEmpty ||
      (password.isNotEmpty && username.isEmpty)) {
    throw const FormatException('Confira host, porta e credenciais do proxy.');
  }
  return ParsedProxyInput(
    protocol: protocol,
    host: host.replaceAll(RegExp(r'^\[|\]$'), ''),
    port: number,
    username: username,
    password: password,
  );
}
