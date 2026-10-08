import { randomUUID } from 'node:crypto';

export function learningFixture() {
  const owner = randomUUID(), viewer = randomUUID(), stranger = randomUUID(), admin = randomUUID(), approver = randomUUID(), story = randomUUID();
  const prefix = `learning_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const users = [owner, viewer, stranger, admin, approver];
  const sql = `
    SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
    INSERT INTO aisha_auth.users (id,email) VALUES ${users.map(id => `('${id}','${id}@example.invalid')`).join(',')};
    INSERT INTO public.user_roles (user_id,role) VALUES ('${admin}','admin'),('${approver}','admin');
    INSERT INTO public.partner_stories (id,title,user_id) VALUES ('${story}','Learning fixture','${owner}');
    INSERT INTO public.story_participants (story_id,user_id,role) VALUES ('${story}','${viewer}','viewer');
  `;
  return { owner, viewer, stranger, admin, approver, story, prefix, sql };
}
