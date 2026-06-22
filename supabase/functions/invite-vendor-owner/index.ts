import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const INVITE_VENDOR_OWNER_ENABLED = Deno.env.get("INVITE_VENDOR_OWNER_ENABLED");
const VENDOR_INVITE_REDIRECT_URL = Deno.env.get("VENDOR_INVITE_REDIRECT_URL");

type VendorApplication = {
  id: string;
  status: string;
  owner_email: string | null;
  approved_vendor_id: string | null;
  owner_auth_user_id: string | null;
  owner_invite_status: string;
  owner_invite_attempt_count: number;
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, error: string, details?: unknown): Response {
  return json({ ok: false, error, details }, status);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function normalizeEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return fail(405, "method_not_allowed");
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return fail(500, "server_misconfigured");
  }

  if (INVITE_VENDOR_OWNER_ENABLED !== "true") {
    return fail(412, "vendor_owner_invites_disabled");
  }

  if (!VENDOR_INVITE_REDIRECT_URL) {
    return fail(500, "vendor_invite_redirect_url_missing");
  }

  const token = bearerToken(req);
  if (!token) {
    return fail(401, "authentication_required");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return fail(401, "authentication_required");
  }

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminError) {
    return fail(500, "admin_lookup_failed");
  }

  if (!adminUser || !["owner", "admin"].includes(adminUser.role)) {
    return fail(403, "owner_or_admin_required");
  }

  let requestBody: { application_id?: string };
  try {
    requestBody = await req.json();
  } catch {
    return fail(400, "invalid_json");
  }

  const applicationId = requestBody.application_id;
  if (!applicationId) {
    return fail(400, "application_id_required");
  }

  const { data: applicationData, error: applicationError } = await supabase
    .from("vendor_applications")
    .select(
      "id,status,owner_email,approved_vendor_id,owner_auth_user_id,owner_invite_status,owner_invite_attempt_count",
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError) {
    return fail(500, "application_lookup_failed");
  }
  if (!applicationData) {
    return fail(404, "application_not_found");
  }

  const application = applicationData as VendorApplication;
  const ownerEmail = normalizeEmail(application.owner_email);

  if (application.status !== "approved") {
    return fail(409, "application_must_be_approved");
  }
  if (!application.approved_vendor_id) {
    return fail(409, "approved_vendor_required");
  }
  if (!ownerEmail) {
    return fail(422, "owner_email_required");
  }

  const now = new Date().toISOString();
  const nextAttemptCount = Number(application.owner_invite_attempt_count ?? 0) + 1;

  let ownerUserId = application.owner_auth_user_id;
  let inviteStatus: "sent" | "accepted" = "sent";
  let authAction: "existing_user_linked" | "invite_sent" = "invite_sent";

  if (!ownerUserId) {
    const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (usersError) {
      await supabase
        .from("vendor_applications")
        .update({
          owner_invite_status: "failed",
          owner_invite_error: "auth_user_lookup_failed",
          owner_invite_last_attempt_at: now,
          owner_invite_attempt_count: nextAttemptCount,
          owner_invite_email: ownerEmail,
          owner_invite_redirect_url: VENDOR_INVITE_REDIRECT_URL,
        })
        .eq("id", application.id);
      return fail(500, "auth_user_lookup_failed");
    }

    const existingUser = usersPage.users.find(
      (authUser) => authUser.email?.toLowerCase() === ownerEmail,
    );

    if (existingUser) {
      ownerUserId = existingUser.id;
      inviteStatus = "accepted";
      authAction = "existing_user_linked";
    } else {
      const { data: inviteData, error: inviteError } =
        await supabase.auth.admin.inviteUserByEmail(ownerEmail, {
          redirectTo: VENDOR_INVITE_REDIRECT_URL,
        });

      if (inviteError || !inviteData.user) {
        const message = inviteError?.message ?? "invite_failed";
        await supabase
          .from("vendor_applications")
          .update({
            owner_invite_status: "failed",
            owner_invite_error: message,
            owner_invite_last_attempt_at: now,
            owner_invite_attempt_count: nextAttemptCount,
            owner_invite_email: ownerEmail,
            owner_invite_redirect_url: VENDOR_INVITE_REDIRECT_URL,
          })
          .eq("id", application.id);

        await supabase.rpc("write_vendor_audit_log", {
          p_vendor_id: application.approved_vendor_id,
          p_action: "vendor_owner_invite_failed",
          p_entity_type: "vendor_application",
          p_entity_id: application.id,
          p_metadata: {
            actor_user_id: user.id,
            owner_email: ownerEmail,
            error: message,
          },
        });

        return fail(502, "vendor_owner_invite_failed", message);
      }

      ownerUserId = inviteData.user.id;
      inviteStatus = "sent";
      authAction = "invite_sent";
    }
  } else {
    inviteStatus = application.owner_invite_status === "accepted" ? "accepted" : "sent";
    authAction = "existing_user_linked";
  }

  const { data: vendorUser, error: vendorUserError } = await supabase
    .from("vendor_users")
    .upsert(
      {
        vendor_id: application.approved_vendor_id,
        user_id: ownerUserId,
        role: "owner",
        status: "active",
      },
      { onConflict: "vendor_id,user_id" },
    )
    .select("id")
    .single();

  if (vendorUserError) {
    await supabase
      .from("vendor_applications")
      .update({
        owner_invite_status: "failed",
        owner_invite_error: "vendor_user_link_failed",
        owner_auth_user_id: ownerUserId,
        owner_invite_last_attempt_at: now,
        owner_invite_attempt_count: nextAttemptCount,
        owner_invite_email: ownerEmail,
        owner_invite_redirect_url: VENDOR_INVITE_REDIRECT_URL,
      })
      .eq("id", application.id);

    return fail(500, "vendor_user_link_failed", vendorUserError.message);
  }

  const { error: updateError } = await supabase
    .from("vendor_applications")
    .update({
      owner_invite_status: inviteStatus,
      owner_invited_at: now,
      owner_invited_by: user.id,
      owner_invite_error: null,
      owner_auth_user_id: ownerUserId,
      created_vendor_user_id: vendorUser.id,
      owner_invite_attempt_count: nextAttemptCount,
      owner_invite_last_attempt_at: now,
      owner_invite_email: ownerEmail,
      owner_invite_redirect_url: VENDOR_INVITE_REDIRECT_URL,
    })
    .eq("id", application.id);

  if (updateError) {
    return fail(500, "invite_tracking_update_failed");
  }

  await supabase.rpc("write_vendor_audit_log", {
    p_vendor_id: application.approved_vendor_id,
    p_action: "vendor_owner_invited",
    p_entity_type: "vendor_application",
    p_entity_id: application.id,
    p_metadata: {
      actor_user_id: user.id,
      owner_user_id: ownerUserId,
      vendor_user_id: vendorUser.id,
      owner_email: ownerEmail,
      invite_status: inviteStatus,
      auth_action: authAction,
      redirect_url: VENDOR_INVITE_REDIRECT_URL,
    },
  });

  return json({
    ok: true,
    application_id: application.id,
    vendor_id: application.approved_vendor_id,
    owner_auth_user_id: ownerUserId,
    vendor_user_id: vendorUser.id,
    owner_invite_status: inviteStatus,
    auth_action: authAction,
  }, 200);
});
