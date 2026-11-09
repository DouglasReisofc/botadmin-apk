import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

class MetaOnboardingFrame extends StatelessWidget {
  const MetaOnboardingFrame({
    super.key,
    required this.url,
    this.onConnected,
    this.onPending,
  });

  final String url;
  final VoidCallback? onConnected;
  final VoidCallback? onPending;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.verified_user_outlined, size: 40),
          const SizedBox(height: 12),
          const Text(
            'O cadastro seguro da Meta será aberto em uma janela protegida do navegador. Ao concluir, volte ao BotAdmin; o painel atualizará a conexão automaticamente.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () async {
              final uri = Uri.parse(url);
              var opened = false;
              try {
                // Custom Tab preserves the browser account/session while the
                // activity stays inside the Flutter task. The manifest keeps
                // botadmin:// for native returns but does not claim HTTPS,
                // so botadmin.shop is not intercepted by this APK.
                opened = await launchUrl(
                  uri,
                  mode: LaunchMode.inAppBrowserView,
                );
                if (!opened) {
                  opened = await launchUrl(
                    uri,
                    mode: LaunchMode.externalApplication,
                  );
                }
              } catch (_) {
                opened = false;
              }
              if (!opened && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Não foi possível abrir o navegador padrão neste aparelho.',
                    ),
                  ),
                );
              }
            },
            icon: const Icon(Icons.verified_user_outlined),
            label: const Text('Conectar API Meta'),
          ),
        ],
      ),
    ),
  );
}
