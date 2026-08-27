import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { PrimaryButton } from "@/components/ui";
import { colors } from "@/lib/theme";

const enteringVideo = require("../assets/entering.mp4");

export default function Index() {
  const [started, setStarted] = useState(false);
  const player = useVideoPlayer(enteringVideo, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const goToLobby = () => router.replace("/lobby");

    const finishedSub = player.addListener("playToEnd", goToLobby);
    // If the video can't load/play for any reason, don't strand the player on a black screen.
    const statusSub = player.addListener("statusChange", ({ status }) => {
      if (status === "error") goToLobby();
    });

    return () => {
      finishedSub.remove();
      statusSub.remove();
    };
  }, [player]);

  // Browsers block autoplaying a video with sound until the user has interacted with
  // the page. Gating playback behind this tap counts as that interaction, so sound
  // reliably plays on web too - not just on native.
  const handlePlay = useCallback(() => {
    setStarted(true);
    player.muted = false;
    player.play();

    // Belt-and-suspenders: if playback still hasn't started shortly after, fall back
    // to muted so the splash plays through instead of sitting frozen either way.
    setTimeout(() => {
      if (!player.playing) {
        player.muted = true;
        player.play();
      }
    }, 700);
  }, [player]);

  return (
    <View style={styles.container}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
      />
      {!started ? (
        <View style={styles.overlay}>
          <PrimaryButton label="Play Game" onPress={handlePlay} style={styles.playButton} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: colors.ink,
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    minWidth: 200,
  },
});
