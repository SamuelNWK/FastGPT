import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonRes } from '@fastgpt/service/common/response';
import { getGuideModule, getAppChatConfig } from '@fastgpt/global/core/workflow/utils';
import { getChatModelNameListByModules } from '@/service/core/app/workflow';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import type { InitChatResponse, InitTeamChatProps } from '@/global/core/chat/api.d';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { getChatItems } from '@fastgpt/service/core/chat/controller';
import { AppErrEnum } from '@fastgpt/global/common/error/code/app';
import { authTeamSpaceToken } from '@/service/support/permission/auth/team';
import { MongoTeam } from '@fastgpt/service/support/user/team/teamSchema';
import { ChatErrEnum } from '@fastgpt/global/common/error/code/chat';
import { getAppLatestVersion } from '@fastgpt/service/core/app/controller';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { transformPreviewHistories } from '@/global/core/chat/utils';
import { NextAPI } from '@/service/middleware/entry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  let { teamId, appId, chatId, teamToken } = req.query as InitTeamChatProps;

  if (!teamId || !appId || !teamToken) {
    throw new Error('teamId, appId, teamToken are required');
  }

  const { uid } = await authTeamSpaceToken({
    teamId,
    teamToken
  });

  const [team, chat, app] = await Promise.all([
    MongoTeam.findById(teamId, 'name avatar').lean(),
    MongoChat.findOne({ teamId, appId, chatId }).lean(),
    MongoApp.findById(appId).lean()
  ]);

  if (!app) {
    throw new Error(AppErrEnum.unExist);
  }

  // auth chat permission
  if (chat && chat.outLinkUid !== uid) {
    throw new Error(ChatErrEnum.unAuthChat);
  }

  // get app and history
  const [{ histories }, { nodes, chatConfig }] = await Promise.all([
    getChatItems({
      appId,
      chatId,
      limit: 30,
      field: `dataId obj value userGoodFeedback userBadFeedback adminFeedback ${DispatchNodeResponseKeyEnum.nodeResponse}`
    }),
    getAppLatestVersion(app._id, app)
  ]);

  jsonRes<InitChatResponse>(res, {
    data: {
      chatId,
      appId,
      title: chat?.title,
      userAvatar: team?.avatar,
      variables: chat?.variables || {},
      history: app.type === AppTypeEnum.plugin ? histories : transformPreviewHistories(histories),
      app: {
        chatConfig: getAppChatConfig({
          chatConfig,
          systemConfigNode: getGuideModule(nodes),
          storeVariables: chat?.variableList,
          storeWelcomeText: chat?.welcomeText,
          isPublicFetch: false
        }),
        chatModels: getChatModelNameListByModules(nodes),
        name: app.name,
        avatar: app.avatar,
        intro: app.intro,
        type: app.type,
        pluginInputs:
          app?.modules?.find((node) => node.flowNodeType === FlowNodeTypeEnum.pluginInput)
            ?.inputs ?? []
      }
    }
  });
}

export default NextAPI(handler);

export const config = {
  api: {
    responseLimit: '10mb'
  }
};
