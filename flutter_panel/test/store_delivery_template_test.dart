import 'package:flutter_panel/src/models/migration_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('store antiga recebe o modelo padrao de entrega unica', () {
    final store = BotStoreSettings.fromJson({
      'id': 1,
      'instanceId': 2,
      'name': 'Minha loja',
      'menuConfig': <String, dynamic>{},
    });

    expect(
      store.deliveryMenu.body,
      contains('🔰 COMPRA EFETUADA COM SUCESSO 🔰'),
    );
    expect(store.deliveryMenu.body, contains('{{produto}}'));
    expect(store.deliveryMenu.body, contains('{{dados}}'));
  });

  test('store preserva o modelo personalizado de entrega', () {
    final store = BotStoreSettings.fromJson({
      'id': 1,
      'instanceId': 2,
      'name': 'Minha loja',
      'menuConfig': {
        'delivery': {'body': 'Pedido {{pedido}}\n{{dados}}'},
      },
    });

    expect(store.deliveryMenu.body, 'Pedido {{pedido}}\n{{dados}}');
  });
}
