"use client";

import { useState } from "react";
import { Crown, Eye, Pencil, Shield, ShieldOff, Swords, UserX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { postJson, type MemberView } from "./shared";

/** One member row with the admin controls (rename / role / admin / kick). */
export function MemberRow({
  member,
  code,
  isMe,
  canAdmin,
  locked,
  onChanged,
}: {
  member: MemberView;
  code: string;
  isMe: boolean;
  canAdmin: boolean;
  locked: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const act = async (body: Record<string, unknown>, done?: string) => {
    const res = await postJson("/api/tournament/admin", { code, memberId: member.id, ...body });
    if (!res.ok) toast.error(res.error);
    else if (done) toast.success(done);
    onChanged();
  };
  const manage = canAdmin && !(member.isOwner && !isMe);
  return (
    <li className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40", isMe && "bg-primary/10")}>
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", member.online ? "bg-green-400" : "bg-muted-foreground/30")}
        title={member.online ? "online" : "offline"}
      />
      {editing ? (
        <form
          className="flex flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            if (name.trim() && name.trim() !== member.name) void act({ action: "rename", name }, "Renamed");
          }}
        >
          <Input autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} className="h-7 text-sm" />
        </form>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">
          {member.name}
          {isMe && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
        </span>
      )}
      {member.isOwner ? (
        <Crown className="h-3.5 w-3.5 text-amber-400" aria-label="host" />
      ) : member.isAdmin ? (
        <Shield className="h-3.5 w-3.5 text-primary" aria-label="admin" />
      ) : null}
      {manage && (
        <div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
          <Act label="Rename" onClick={() => { setName(member.name); setEditing(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Act>
          {!locked && (
            <Act
              label={member.role === "participant" ? "Make spectator" : "Make participant"}
              onClick={() => act({ action: "role", role: member.role === "participant" ? "spectator" : "participant" })}
            >
              {member.role === "participant" ? <Eye className="h-3.5 w-3.5" /> : <Swords className="h-3.5 w-3.5" />}
            </Act>
          )}
          {!member.isOwner && (
            <Act
              label={member.isAdmin ? "Remove admin" : "Make admin"}
              onClick={() => act({ action: "admin", isAdmin: !member.isAdmin }, member.isAdmin ? "Admin removed" : `${member.name} is now an admin`)}
            >
              {member.isAdmin ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
            </Act>
          )}
          {!member.isOwner && (
            <Act
              label="Kick"
              danger
              onClick={() => {
                if (confirm(`Remove ${member.name} from the tournament?${locked ? " They forfeit any match in progress." : ""}`)) {
                  void act({ action: "kick" }, `${member.name} removed`);
                }
              }}
            >
              <UserX className="h-3.5 w-3.5" />
            </Act>
          )}
        </div>
      )}
    </li>
  );
}

function Act({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("rounded p-1 text-muted-foreground hover:bg-muted", danger ? "hover:text-red-400" : "hover:text-foreground")}
    >
      {children}
    </button>
  );
}
