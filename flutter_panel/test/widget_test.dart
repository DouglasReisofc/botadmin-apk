import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_panel/src/models/bot_group.dart';
import 'package:flutter_panel/src/models/bot_group_settings.dart';
import 'package:flutter_panel/src/models/bot_instance.dart';
import 'package:flutter_panel/src/models/migration_models.dart';

void main() {
  test('status recebido não usa rota de mídia como legenda', () {
    final status = ReceivedStatus.fromJson({
      'id': 'status-1',
      'senderName': 'Contato',
      'instanceName': 'Perfil',
      'mediaUrl': '/api/bot-instances/584/status/media',
      'preview': '/api/bot-instances/584/status/media',
      'type': 'video',
      'mimeType': 'video/mp4',
      'backgroundColor': '#FFAABBCC',
      'textColor': '#FFFFFFFF',
      'fontStyle': 'SYSTEM',
    });

    expect(status.bodyText, isNull);
    expect(status.preview, isNull);
    expect(status.isVideo, isTrue);
    expect(status.backgroundColor, '#FFAABBCC');
  });

  test('parseia instancia conectada da API do BotAdmin', () {
    final instance = BotInstance.fromJson({
      'id': '12',
      'name': 'Alluka',
      'sessionStatus': 'conectado',
      'phoneNumber': '5592995296926',
    });

    expect(instance.id, 12);
    expect(instance.name, 'Alluka');
    expect(instance.phoneNumber, '5592995296926');
    expect(instance.isConnected, isTrue);
  });

  test('parseia grupo ativo pelo status retornado pela API', () {
    final group = BotGroup.fromJson({
      'id': '1493',
      'name': 'Grupo Vip',
      'remoteId': '120363312745891150@g.us',
      'status': 'active',
    });

    expect(group.id, 1493);
    expect(group.remoteJid, '120363312745891150@g.us');
    expect(group.botEnabled, isTrue);
  });

  test('parseia grupo desativado pelo status retornado pela API', () {
    final group = BotGroup.fromJson({
      'id': 1493,
      'name': 'Grupo Vip',
      'remoteId': '120363312745891150@g.us',
      'status': 'disabled',
    });

    expect(group.botEnabled, isFalse);
  });

  test('parseia configuracoes avancadas do grupo', () {
    final settings = BotGroupSettings.fromJson({
      'commandToggles': {'autoresposta': true},
      'blacklist': ['5592999999999'],
      'autoResponses': [
        {
          'id': 'auto-1',
          'triggers': ['oi', 'menu'],
          'responseText': 'Ola!',
          'matchMode': 'contains',
          'responseMedia': {
            'mediaType': 'image',
            'url': 'https://x.test/a.jpg',
          },
        },
      ],
      'horapgConfig': {
        'enabled': true,
        'times': ['08:00', '18:00'],
        'imageUrl': 'https://x.test/hora.jpg',
        'mentionAll': true,
        'timezone': 'America/Sao_Paulo',
      },
      'scheduleConfig': {
        'closeEnabled': true,
        'closeTimes': ['00:00'],
        'openEnabled': true,
        'openTimes': ['07:00'],
      },
    });

    expect(settings.isEnabled('autoresposta'), isTrue);
    expect(settings.blacklist, contains('5592999999999'));
    expect(settings.autoResponses.single.triggers, contains('menu'));
    expect(settings.autoResponses.single.matchMode, 'contains');
    expect(settings.autoResponses.single.toJson()['responseMedia'], isNotNull);
    expect(settings.horapgConfig.enabled, isTrue);
    expect(settings.horapgConfig.mentionAll, isTrue);
    expect(settings.scheduleConfig.closeTimes, contains('00:00'));
  });

  test('parseia checkout de perfil com expiresAt em string ISO', () {
    final checkout = PlanCheckout.fromJson({
      'paymentId': 'tx-1',
      'providerPaymentId': 'tx-1',
      'provider': 'polopag_pix',
      'amount': '25.00',
      'qrCode': '000201...',
      'qrCodeBase64': 'iVBORw0KGgo=',
      'expiresAt': '2026-07-20T19:00:00.000Z',
    });

    expect(checkout.paymentId, 'tx-1');
    expect(checkout.provider, 'polopag_pix');
    expect(checkout.amount, 25);
    expect(checkout.expiresAt, isNotNull);
  });

  test('parseia textos personalizados do menu de compra da rifa', () {
    final menu = UserRafflePurchaseMenuSettings.fromJson({
      'title': 'Escolha seus números',
      'description': 'Selecione a quantidade desejada.',
      'buttonText': 'Comprar agora',
      'footerText': '{{title}} por {{price}}',
      'cardTitleTemplate': 'De {{from}} até {{to}}',
      'rowTitleTemplate': '{{quantity}} números por {{total}}',
      'rowDescriptionTemplate': '{{quantity}} vezes {{price}}',
    });

    expect(menu.title, 'Escolha seus números');
    expect(menu.buttonText, 'Comprar agora');
    expect(menu.cardTitleTemplate, 'De {{from}} até {{to}}');
    expect(menu.rowTitleTemplate, contains('{{total}}'));
    expect(menu.toJson()['rowDescriptionTemplate'], contains('{{price}}'));
  });

  test('parseia configuracao de pagamento da rifa sem expor credencial', () {
    final settings = RafflePaymentSettings.fromJson({
      'configured': true,
      'activeProvider': 'mercadopago_pix',
      'mercadoPago': {
        'isConfigured': true,
        'credentialMask': 'APP_••••1234',
        'pixExpirationMinutes': 45,
      },
      'poloPag': {
        'isConfigured': false,
        'credentialMask': null,
        'pixExpirationMinutes': 30,
      },
      'links': {
        'mercadoPagoCredentials':
            'https://www.mercadopago.com.br/developers/panel/app',
      },
    });

    expect(settings.configured, isTrue);
    expect(settings.activeProvider, 'mercadopago_pix');
    expect(settings.mercadoPagoCredentialMask, 'APP_••••1234');
    expect(settings.mercadoPagoExpirationMinutes, 45);
    expect(settings.poloPagConfigured, isFalse);
    expect(settings.mercadoPagoCredentialsUrl, contains('mercadopago.com.br'));
  });

  test('parseia loja digital e integracao Central Cart', () {
    final snapshot = BotStoreSnapshot.fromJson({
      'store': {
        'id': 7,
        'instanceId': 266,
        'enabled': true,
        'autoOpenPrivate': false,
        'name': 'Loja Alluka',
        'description': 'Produtos digitais',
        'commands': ['loja', 'catalogo'],
        'paymentProvider': 'mercadopago_pix',
        'menuConfig': {
          'root': {
            'title': 'Catálogo {{store}}',
            'body': 'Escolha uma categoria',
            'footer': 'Atendimento seguro',
            'listButton': 'Abrir catálogo',
            'imagePath': 'store/menu-root.webp',
            'imageUrl': 'https://cdn.test/menu-root.webp',
          },
          'category': {
            'title': '{{category}}',
            'body': 'Produtos disponíveis',
            'footer': '{{store}}',
            'listButton': 'Ver produtos',
            'productRow': '{{price}}',
          },
          'product': {
            'title': '{{product}}',
            'body': '{{description}}\n{{price}}',
            'footer': '{{store}}',
            'listButton': '',
            'buyButton': 'Comprar',
            'backButton': 'Voltar',
          },
          'iptv': {
            'title': 'TV da {{store}}',
            'body': 'Teste, compre ou renove seu acesso.',
            'footer': '{{plan_count}} opções',
            'listButton': 'Abrir planos',
            'buyButton': 'Assinar',
            'backButton': 'Voltar',
            'productRow': '{{price}} · {{validity}} · {{screens}}',
            'trialUsedBody': 'Teste já usado por {{numero_cliente}}',
            'trialUsedButton': 'Escolher plano',
            'macPromptBody': 'Envie o MAC do {{app}}',
            'macAccessBody': 'MAC {{mac}} recebido',
            'macAccessButton': 'Escolher usuário',
            'macAppBody': 'Aplicativos de {{usuario}}',
            'macAppButton': 'Escolher app',
            'appActivatedBody': '{{app}} ativado em {{mac}}',
          },
        },
        'centralCart': {
          'connected': true,
          'apiKeyHint': 'abcd...wxyz',
          'mode': 'live',
          'checkoutGateway': 'PIX',
          'app': {'name': 'Central BotAdmin'},
        },
      },
      'categories': [
        {'id': 3, 'name': 'Cursos', 'enabled': true},
      ],
      'products': [
        {
          'id': 12,
          'categoryId': 3,
          'name': 'Curso completo',
          'priceCents': 2500,
          'inventory': {
            'available': 8,
            'reserved': 1,
            'delivered': 4,
            'disabled': 0,
          },
          'enabled': true,
        },
      ],
      'inventory': [
        {
          'id': 40,
          'productId': 12,
          'itemType': 'file',
          'deliveryFileUrl': 'https://cdn.test/curso.zip',
          'deliveryFileName': 'curso.zip',
          'status': 'available',
          'maxUses': 20,
          'usedCount': 6,
          'reservedUses': 2,
          'remainingUses': 12,
        },
      ],
      'orders': [
        {
          'id': 20,
          'publicId': 'STORE-20',
          'productId': 12,
          'customerJid': '559299999999@s.whatsapp.net',
          'customerName': 'Cliente',
          'totalCents': 2500,
          'status': 'paid',
        },
      ],
      'customers': [
        {
          'id': 9,
          'customerJid': '559299999999@s.whatsapp.net',
          'customerName': 'Cliente',
          'customerPhone': '559299999999',
          'avatarUrl': 'https://cdn.test/avatar.webp',
          'balanceCents': 1750,
          'ordersCount': 3,
          'paidOrdersCount': 2,
          'totalSpentCents': 5000,
          'blocked': false,
        },
      ],
      'wwPanel': {
        'connected': true,
        'enabled': true,
        'apiKeyHint': 'wz_ab...1234',
        'lastVerifiedAt': '2026-07-29T18:00:00.000Z',
        'account': {'username': 'revendedor', 'credits': 12.5, 'status': 1},
        'catalog': {
          'plans': [
            {'id': 2, 'name': 'Essencial'},
          ],
          'addons': [
            {'id': 7, 'name': 'Nexus'},
          ],
          'iptvPackages': [
            {'id': 30, 'name': 'Brasil'},
          ],
          'p2pPackages': [
            {'id': 'p2p-br', 'name': 'Brasil'},
          ],
          'apps': ['IPTV4K', 'Wapp', 'Kplay'],
          'appTypes': {'IPTV4K': 'iptv', 'Wapp': 'xstream', 'Kplay': 'xstream'},
        },
      },
      'wwPanelOffers': [
        {
          'id': 31,
          'name': 'IPTV mensal',
          'description': 'Acesso completo',
          'priceCents': 2500,
          'enabled': true,
          'position': 1,
          'isTrial': false,
          'days': 30,
          'planId': 2,
          'packageP2p': 'p2p-br',
          'packageIptv': 30,
          'accessIptv': 1,
          'accessNexus': 0,
          'addons': [7],
          'country': 'Brasil',
        },
      ],
      'wwPanelClients': [
        {
          'id': 44,
          'offerId': 31,
          'orderId': 20,
          'customerJid': '559299999999@s.whatsapp.net',
          'customerName': 'Cliente',
          'customerPhone': '559299999999',
          'externalId': '62586057',
          'username': 'cliente01',
          'passwordHint': '••••••••',
          'expiresAt': '2026-08-29T18:00:00.000Z',
          'status': 'active',
          'isTrial': true,
          'createdAt': '2026-07-29T18:00:00.000Z',
          'updatedAt': '2026-07-29T18:00:00.000Z',
        },
      ],
    });

    expect(snapshot.store.enabled, isTrue);
    expect(snapshot.store.autoOpenPrivate, isFalse);
    expect(snapshot.store.centralCartConnected, isTrue);
    expect(snapshot.store.centralCartApiKeyHint, 'abcd...wxyz');
    expect(snapshot.store.rootMenu.title, 'Catálogo {{store}}');
    expect(snapshot.store.rootMenu.imagePath, 'store/menu-root.webp');
    expect(snapshot.store.categoryMenu.productRow, '{{price}}');
    expect(snapshot.store.productMenu.buyButton, 'Comprar');
    expect(snapshot.store.iptvMenu.title, 'TV da {{store}}');
    expect(snapshot.store.iptvMenu.listButton, 'Abrir planos');
    expect(snapshot.store.iptvMenu.productRow, contains('{{validity}}'));
    expect(
      snapshot.store.iptvMenu.trialUsedBody,
      contains('{{numero_cliente}}'),
    );
    expect(snapshot.store.iptvMenu.trialUsedButton, 'Escolher plano');
    expect(snapshot.store.iptvMenu.macPromptBody, contains('{{app}}'));
    expect(snapshot.store.iptvMenu.macAccessBody, contains('{{mac}}'));
    expect(snapshot.store.iptvMenu.macAppBody, contains('{{usuario}}'));
    expect(snapshot.store.iptvMenu.appActivatedBody, contains('{{mac}}'));
    expect(snapshot.categories.single.name, 'Cursos');
    expect(snapshot.products.single.inventoryAvailable, 8);
    expect(snapshot.products.single.inventoryTotal, 13);
    expect(snapshot.inventory.single.deliveryFileName, 'curso.zip');
    expect(snapshot.inventory.single.maxUses, 20);
    expect(snapshot.inventory.single.usedCount, 6);
    expect(snapshot.inventory.single.reservedUses, 2);
    expect(snapshot.inventory.single.remainingUses, 12);
    expect(snapshot.orders.single.status, 'paid');
    expect(snapshot.orders.single.customerJid, '559299999999@s.whatsapp.net');
    expect(snapshot.customers.single.displayName, 'Cliente');
    expect(snapshot.customers.single.balance, 17.5);
    expect(snapshot.customers.single.ordersCount, 3);
    expect(snapshot.wwPanel.connected, isTrue);
    expect(snapshot.wwPanel.accountName, 'revendedor');
    expect(snapshot.wwPanel.apiKeyHint, 'wz_ab...1234');
    expect(snapshot.wwPanel.plans.single['id'], 2);
    expect(snapshot.wwPanel.apps, contains('Kplay'));
    expect(snapshot.wwPanel.apps, contains('IPTV4K'));
    expect(snapshot.wwPanel.appTypes['IPTV4K'], 'iptv');
    expect(snapshot.wwPanel.appTypes['Kplay'], 'xstream');
    expect(snapshot.wwPanelOffers.single.name, 'IPTV mensal');
    expect(snapshot.wwPanelOffers.single.price, 25);
    expect(snapshot.wwPanelOffers.single.validityLabel, '30 dias');
    expect(snapshot.wwPanelClients.single.externalId, '62586057');
    expect(snapshot.wwPanelClients.single.customerLabel, 'Cliente');
    expect(snapshot.wwPanelClients.single.isTrial, isTrue);
  });

  test('aplica o menu padrao completo da StoreZap sem imagem implicita', () {
    final snapshot = BotStoreSnapshot.fromJson({
      'store': {
        'id': 8,
        'instanceId': 267,
        'enabled': true,
        'name': 'Minha Store',
        'commands': ['loja'],
        'centralCart': <String, Object?>{},
      },
    });

    expect(snapshot.store.rootMenu.body, contains('{{pushname}}'));
    expect(snapshot.store.rootMenu.body, contains('{{numero_cliente}}'));
    expect(snapshot.store.rootMenu.body, contains('{{saldo_cliente}}'));
    expect(
      snapshot.store.rootMenu.footer,
      contains('continuar seu atendimento'),
    );
    expect(snapshot.store.rootMenu.listButton, 'Ver categorias');
    expect(snapshot.store.rootMenu.productRow, '{{price}} · {{stock}}');
    expect(snapshot.store.rootMenu.imagePath, isNull);
    expect(snapshot.store.categoryMenu.listButton, 'Ver serviços');
    expect(snapshot.store.iptvMenu.title, 'Planos IPTV');
    expect(snapshot.store.iptvMenu.listButton, 'Abrir IPTV 📺');
    expect(snapshot.store.iptvMenu.productRow, contains('{{screens}}'));
    expect(snapshot.store.iptvMenu.trialUsedBody, contains('teste gratuito'));
    expect(snapshot.store.iptvMenu.trialUsedButton, contains('Voltar'));
    expect(snapshot.store.iptvMenu.macPromptBody, contains('{{app}}'));
    expect(snapshot.store.iptvMenu.macAccessBody, contains('{{mac}}'));
    expect(snapshot.store.iptvMenu.macAppBody, contains('{{usuario}}'));
    expect(snapshot.store.iptvMenu.appActivatedBody, contains('{{app}}'));
  });
}
