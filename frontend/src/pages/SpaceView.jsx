import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import useRequireAuth from "../hooks/useRequireAuth";
import useSpaceView from "../hooks/useSpaceView";
import MembersList from "../components/SpaceView/MembersList";
import InviteModal from "../components/SpaceView/InviteModal";
import ContributeModal from "../components/SpaceView/ContributeModal";
import LeaveModal from "../components/SpaceView/LeaveModal";
import RequestRoleModal from "../components/SpaceView/RequestRoleModal";
import DeleteSpaceModal from "../components/SpaceView/DeleteSpaceModal";

export default function SpaceView() {
  const { id } = useParams();
  const { user, token, loading, isAuthenticated } = useRequireAuth();
  const navigate = useNavigate();

  const {
    space,
    spaceLoading,
    spaceError,
    members,
    membersLoading,
    roleUpdatingUserId,
    roleUpdateError,
    handleRoleChange,
    fetchMembers,
  } = useSpaceView({ id, token, userId: user?.id });

  const [openModal, setOpenModal] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) return;
    if (spaceLoading) return;

    if (spaceError) {
      navigate("/spaces", { replace: true });
    }
  }, [isAuthenticated, loading, spaceLoading, spaceError, navigate]);

  if (loading) return <p>Loading…</p>;
  if (!isAuthenticated) return null;
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
          <button onClick={() => setOpenModal("invite")}>Invite</button>
        )}
        {["admin", "moderator", "contributor"].includes(space.role) && (
          <button onClick={() => setOpenModal("contribute")}>Contribute</button>
        )}
        {space.role !== "admin" && (
          <button onClick={() => setOpenModal("requestRole")}>
            Request role upgrade
          </button>
        )}
        {space.role === "admin" && (
          <button onClick={() => setOpenModal("delete")}>Delete Space</button>
        )}
        <button onClick={() => setOpenModal("leave")}>Leave</button>
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

      {openModal === "invite" && (
        <InviteModal
          space={space}
          token={token}
          onInviteSuccess={() => fetchMembers()}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "contribute" && (
        <ContributeModal
          space={space}
          token={token}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "leave" && (
        <LeaveModal
          space={space}
          token={token}
          members={members}
          currentUserId={user?.id}
          onLeave={() => navigate("/spaces")}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "requestRole" && (
        <RequestRoleModal
          space={space}
          token={token}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "delete" && (
        <DeleteSpaceModal
          space={space}
          token={token}
          onDeleted={() => navigate("/spaces")}
          onClose={() => setOpenModal(null)}
        />
      )}
    </div>
  );
}
