import 'package:flutter/services.dart';

const _nativeChannel = MethodChannel('botadmin/native');

Future<bool> saveContact({
  required String displayName,
  required String phoneNumber,
  required String vcard,
}) async {
  return await _nativeChannel.invokeMethod<bool>('saveContact', {
        'displayName': displayName,
        'phoneNumber': phoneNumber,
        'vcard': vcard,
      }) ??
      false;
}
