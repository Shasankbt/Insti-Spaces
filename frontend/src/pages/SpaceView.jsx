import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import useSpaceView from "../hooks/useSpaceView";
import MembersList from "../components/SpaceView/MembersList";
import InviteModal from "../components/SpaceView/InviteModal";
import ContributeModal from "../components/SpaceView/ContributeModal";
import LeaveModal from "../components/SpaceView/LeaveModal";
import RequestRoleModal from "../components/SpaceView/RequestRoleModal";
import DeleteSpaceModal from "../components/SpaceView/DeleteSpaceModal";

export default function SpaceView() {
  const { id } = useParams();
  const { user, token, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    space,
    spaceLoading,
    spaceError,
    members,
    membersLoading,
    roleUpdatingUserId,
    roleUpdateError,
    handleRoleChange,
  } = useSpaceView({ id, token });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [requestRoleOpen, setRequestRoleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      navigate(
        `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`,
        { replace: true },
      );
    }
  }, [user, token, loading, navigate, location.pathname, location.search]);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) return;
    if (spaceLoading) return;

    if (spaceError) {
      navigate("/spaces", { replace: true });
    }
  }, [user, token, loading, spaceLoading, spaceError, navigate]);

  if (loading) return <p>Loading…</p>;
  if (!user || !token) return null;
  if (spaceLoading) return <p>Loading…</p>;
  if (spaceError) return null;
  if (!space) return <p>Loading…</p>;

  return (
    <div>
      <button onClick={() => navigate("/spaces")}>← Back</button>
      <h2>{space.spacename}</h2>
      <p>Your role: {space.role}</p>

      <div>
        {space.role === "admin" && (
          <button onClick={() => setInviteOpen(true)}>Invite</button>
        )}
        {["admin", "moderator", "contributor"].includes(space.role) && (
          <button onClick={() => setContributeOpen(true)}>Contribute</button>
        )}
        {space.role !== "admin" && (
          <button onClick={() => setRequestRoleOpen(true)}>
            Request role upgrade
          </button>
        )}
        {space.role === "admin" && (
          <button onClick={() => setDeleteOpen(true)}>Delete Space</button>
        )}
        <button onClick={() => setLeaveOpen(true)}>Leave</button>
      </div>

      <MembersList
        members={members}
        loading={membersLoading}
        currentUserId={user?.id}
        myRole={space.role}
        onRoleChange={handleRoleChange}
        roleUpdatingUserId={roleUpdatingUserId}
        roleUpdateError={roleUpdateError}
      />

      {inviteOpen && (
        <InviteModal
          space={space}
          token={token}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {contributeOpen && (
        <ContributeModal
          space={space}
          token={token}
          onClose={() => setContributeOpen(false)}
        />
      )}
      {leaveOpen && (
        <LeaveModal
          space={space}
          token={token}
          members={members}
          currentUserId={user?.id}
          onLeave={() => navigate("/spaces")}
          onClose={() => setLeaveOpen(false)}
        />
      )}
      {requestRoleOpen && (
        <RequestRoleModal
          space={space}
          token={token}
          onClose={() => setRequestRoleOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteSpaceModal
          space={space}
          token={token}
          onDeleted={() => navigate("/spaces")}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}
