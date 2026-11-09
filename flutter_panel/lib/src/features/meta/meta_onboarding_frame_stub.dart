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
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 440;
        return DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [colors.primary.withValues(alpha: .12), colors.surface],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: SingleChildScrollView(
            padding: EdgeInsets.all(compact ? 16 : 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  height: compact ? 120 : 160,
                  child: Image.asset(
                    'assets/brand/meta-connect-3d.png',
                    fit: BoxFit.contain,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Conexão oficial e segura',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'A Meta abrirá a autorização no navegador. Ao concluir, o BotAdmin volta automaticamente para esta tela e atualiza o perfil.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: colors.onSurfaceVariant),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
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
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
