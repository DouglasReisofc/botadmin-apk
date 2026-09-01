import { listActiveStatusPostsForCampaign, markStatusPostDeleted } from "lib/bot-ad-campaigns";
import { getInstanceForUser } from "lib/bot-instances";
import { deleteStatusUpdate } from "lib/wuzapi";

export const removeStatusPostsForCampaign = async (userId: number, campaignId: number): Promise<void> => {
  const posts = await listActiveStatusPostsForCampaign(campaignId);
  for (const post of posts) {
    try {
      const instance = await getInstanceForUser(userId, post.instance_id);
      if (!instance) {
        await markStatusPostDeleted(post.id, post.message_id ?? null, "Instância não encontrada ao apagar status.");
        continue;
      }
      if (post.message_id) {
        await deleteStatusUpdate(
          {
            baseUrl: instance.serverBaseUrl,
            token: instance.token,
          },
          { id: post.message_id },
        );
      }
      await markStatusPostDeleted(post.id, post.message_id ?? null);
    } catch (error) {
      await markStatusPostDeleted(
        post.id,
        post.message_id ?? null,
        error instanceof Error ? error.message : "Erro ao remover status",
      );
    }
  }
};
