'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileForm = ProfileForm;
var zod_1 = require("@hookform/resolvers/zod");
var react_hook_form_1 = require("react-hook-form");
var z = require("zod");
var button_1 = require("@/components/ui/button");
var input_1 = require("@/components/ui/input");
var textarea_1 = require("@/components/ui/textarea");
var label_1 = require("@/components/ui/label");
var react_1 = require("next-auth/react");
var react_2 = require("react");
var sonner_1 = require("sonner");
var profileFormSchema = z.object({
    username: z.string().min(2, { message: 'Username must be at least 2 characters.' }).max(30),
    email: z.string().email(),
    role: z.string(),
    bio: z.string().max(160).optional(),
});
function ProfileForm() {
    var session = (0, react_1.useSession)().data;
    var form = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_1.zodResolver)(profileFormSchema),
        defaultValues: {
            username: '',
            email: '',
            role: '',
            bio: '',
        },
        mode: 'onChange',
    });
    (0, react_2.useEffect)(function () {
        if (session === null || session === void 0 ? void 0 : session.user) {
            form.setValue('username', session.user.name || '');
            form.setValue('email', session.user.email || '');
            form.setValue('role', session.user.role || 'Member');
        }
    }, [session, form]);
    function onSubmit(data) {
        sonner_1.toast.success('Profile updated successfully');
        console.log('Profile update:', data);
    }
    return (<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <label_1.Label htmlFor="username">Username</label_1.Label>
        <input_1.Input id="username" placeholder="Your username" {...form.register('username')}/>
        {form.formState.errors.username && (<p className="text-sm text-destructive">{form.formState.errors.username.message}</p>)}
        <p className="text-sm text-muted-foreground">This is your public display name.</p>
      </div>

      <div className="space-y-2">
        <label_1.Label htmlFor="email">Email</label_1.Label>
        <input_1.Input id="email" placeholder="Your email" {...form.register('email')} disabled/>
        <p className="text-sm text-muted-foreground">Managed by your identity provider.</p>
      </div>

      <div className="space-y-2">
        <label_1.Label htmlFor="role">Role</label_1.Label>
        <input_1.Input id="role" {...form.register('role')} disabled/>
        <p className="text-sm text-muted-foreground">Your assigned role in the organization.</p>
      </div>

      <div className="space-y-2">
        <label_1.Label htmlFor="bio">Bio</label_1.Label>
        <textarea_1.Textarea id="bio" placeholder="Tell us a little bit about yourself" className="resize-none" {...form.register('bio')}/>
        {form.formState.errors.bio && (<p className="text-sm text-destructive">{form.formState.errors.bio.message}</p>)}
      </div>

      <button_1.Button type="submit">Update profile</button_1.Button>
    </form>);
}
