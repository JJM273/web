package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamingSettingDefaults(t *testing.T) {
	s := Setting{}
	// Verify Streaming field exists and has zero values
	assert.False(t, s.Streaming.Enabled)
	assert.Equal(t, time.Duration(0), s.Streaming.PingInterval)
	assert.Equal(t, time.Duration(0), s.Streaming.PingTimeout)
}

func newTestStreamHandler(enabled bool) (*Handler, *echo.Echo) {
	e := echo.New()
	hdlr := &Handler{
		setting: Setting{
			Secret: "test-secret",
			Streaming: Streaming{
				Enabled:      enabled,
				PingInterval: 30 * time.Second,
				PingTimeout:  10 * time.Second,
			},
		},
	}
	e.GET("/api/v1/stream", hdlr.HandleStream)
	return hdlr, e
}

func newTestStreamHandlerWithRepo(t *testing.T) (*Handler, *echo.Echo, string) {
	t.Helper()
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	t.Cleanup(func() { repo.db.Close() })

	e := echo.New()
	hdlr := &Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dir,
			Streaming: Streaming{
				Enabled:      true,
				PingInterval: 30 * time.Second,
				PingTimeout:  10 * time.Second,
			},
		},
	}
	e.GET("/api/v1/stream", hdlr.HandleStream)
	return hdlr, e, dir
}

// sendStartMission sends a properly formatted start_mission envelope and reads the ack.
func sendStartMission(t *testing.T, conn *websocket.Conn, missionName, worldName string) {
	t.Helper()
	startPayload, _ := json.Marshal(map[string]any{
		"mission": map[string]any{"MissionName": missionName, "CaptureDelay": 1.0},
		"world":   map[string]any{"WorldName": worldName},
	})
	err := conn.WriteJSON(map[string]any{
		"type":    "start_mission",
		"payload": json.RawMessage(startPayload),
	})
	require.NoError(t, err)
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	require.Equal(t, "start_mission", ack["for"])
}

func TestHandleStream_Disabled(t *testing.T) {
	_, e := newTestStreamHandler(false)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestHandleStream_WrongSecret(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=wrong"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestHandleStream_BrowserOriginRejected(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": {"https://evil.example.com"}})
	require.Error(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestHandleStream_UpgradeSuccess(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	conn.Close()
}

func TestHandleStream_StartMissionAck(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	sendStartMission(t, conn, "Test Mission", "altis")
}

func TestHandleStream_EndMissionAckAndClose(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	sendStartMission(t, conn, "Test", "altis")

	// Send some state messages (no payload — will be skipped with a warning)
	for i := 0; i < 5; i++ {
		conn.WriteJSON(map[string]any{"type": "soldier_state"})
	}

	// Send end_mission
	err = conn.WriteJSON(map[string]string{"type": "end_mission"})
	require.NoError(t, err)

	// Read ack
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "ack", ack["type"])
	assert.Equal(t, "end_mission", ack["for"])

	// Connection should be closed by server — next read should fail
	_, _, err = conn.ReadMessage()
	assert.Error(t, err)
}

func TestHandleStream_UnknownTypesAccepted(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send unknown message types — should not error
	err = conn.WriteJSON(map[string]string{"type": "unknown_type_1"})
	require.NoError(t, err)
	err = conn.WriteJSON(map[string]string{"type": "unknown_type_2"})
	require.NoError(t, err)

	// Send end_mission to cleanly close
	conn.WriteJSON(map[string]string{"type": "end_mission"})
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "end_mission", ack["for"])
}

func TestHandleStream_InvalidJSON(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send invalid JSON — should be skipped, not crash
	err = conn.WriteMessage(websocket.TextMessage, []byte("not json"))
	require.NoError(t, err)

	// Server should still be alive — send valid start_mission
	sendStartMission(t, conn, "Test", "altis")
}

func TestHandleStream_NormalClose(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)

	// Send a proper WebSocket close frame (triggers normal close path)
	err = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	require.NoError(t, err)
	conn.Close()
}

func TestHandleStream_ZeroConfigFallbacks(t *testing.T) {
	e := echo.New()
	hdlr := &Handler{
		setting: Setting{
			Secret: "test-secret",
			Streaming: Streaming{
				Enabled: true,
				// PingInterval and PingTimeout intentionally zero
			},
		},
	}
	e.GET("/api/v1/stream", hdlr.HandleStream)

	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Verify connection works with fallback values
	err = conn.WriteJSON(map[string]string{"type": "end_mission"})
	require.NoError(t, err)
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "end_mission", ack["for"])
}

func TestNewHandler_StreamRouteRegistered(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()
	repoMarker, _ := NewRepoMarker(filepath.Join(dir, "markers"))
	repoAmmo, _ := NewRepoAmmo(filepath.Join(dir, "ammo"))

	e := echo.New()
	NewHandler(e, repo, repoMarker, repoAmmo, Setting{PrefixURL: "/sub/"})

	routePaths := make([]string, 0)
	for _, r := range e.Routes() {
		routePaths = append(routePaths, r.Path)
	}
	assert.Contains(t, routePaths, "/sub/api/v1/stream")
}

func TestHandleStream_FullLifecycle(t *testing.T) {
	hdlr, e, dir := newTestStreamHandlerWithRepo(t)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send start_mission with envelope format
	startPayload, _ := json.Marshal(map[string]any{
		"mission": map[string]any{
			"MissionName":  "Lifecycle Test",
			"CaptureDelay": 1.0,
			"Tag":          "TvT",
		},
		"world": map[string]any{
			"WorldName": "altis",
		},
	})
	conn.WriteJSON(map[string]any{
		"type":    "start_mission",
		"payload": json.RawMessage(startPayload),
	})
	var ack map[string]string
	conn.ReadJSON(&ack)
	require.Equal(t, "start_mission", ack["for"])

	// Send add_soldier
	solPayload, _ := json.Marshal(map[string]any{
		"ID": 1, "JoinFrame": 0, "OcapType": "unit",
		"UnitName": "TestPlayer", "Side": "WEST",
		"GroupID": "Alpha", "IsPlayer": true,
	})
	conn.WriteJSON(map[string]any{"type": "add_soldier", "payload": json.RawMessage(solPayload)})

	// Send soldier states
	for i := 0; i < 3; i++ {
		stPayload, _ := json.Marshal(map[string]any{
			"SoldierID": 1, "CaptureFrame": i,
			"Position": map[string]any{"x": 100 + i, "y": 200, "z": 10},
			"Bearing": 90, "Lifestate": 0, "IsPlayer": true,
			"UnitName": "TestPlayer", "GroupID": "Alpha", "Side": "WEST",
		})
		conn.WriteJSON(map[string]any{"type": "soldier_state", "payload": json.RawMessage(stPayload)})
	}

	// Send end_mission
	conn.WriteJSON(map[string]any{"type": "end_mission", "payload": json.RawMessage("{}")})
	conn.ReadJSON(&ack)
	require.Equal(t, "end_mission", ack["for"])

	// Verify a .json.gz file was written
	files, _ := filepath.Glob(filepath.Join(dir, "*.json.gz"))
	assert.NotEmpty(t, files, "expected a .json.gz file to be written")

	// Verify operation was stored in DB
	ops, err := hdlr.repoOperation.Select(context.Background(), Filter{})
	require.NoError(t, err)
	found := false
	for _, op := range ops {
		if op.MissionName == "Lifecycle Test" {
			found = true
			assert.Equal(t, "altis", op.WorldName)
			assert.Equal(t, ConversionStatusCompleted, op.ConversionStatus)
			break
		}
	}
	assert.True(t, found, "expected finalized operation in DB")
}

func TestHandleStream_CrashDisconnectFinalizes(t *testing.T) {
	_, e, dir := newTestStreamHandlerWithRepo(t)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)

	// Start mission
	sendStartMission(t, conn, "Crash Test", "altis")

	// Send some data
	solPayload, _ := json.Marshal(map[string]any{
		"ID": 1, "JoinFrame": 0, "OcapType": "unit", "UnitName": "P1", "Side": "WEST",
	})
	conn.WriteJSON(map[string]any{"type": "add_soldier", "payload": json.RawMessage(solPayload)})

	stPayload, _ := json.Marshal(map[string]any{
		"SoldierID": 1, "CaptureFrame": 0,
		"Position": map[string]any{"x": 100, "y": 200, "z": 10},
	})
	conn.WriteJSON(map[string]any{"type": "soldier_state", "payload": json.RawMessage(stPayload)})

	// Simulate crash: just close without end_mission
	conn.Close()

	// Give server time to detect close and finalize
	time.Sleep(200 * time.Millisecond)

	// Verify a file was written (partial data)
	files, _ := filepath.Glob(filepath.Join(dir, "*.json.gz"))
	assert.NotEmpty(t, files, "expected partial .json.gz file after crash disconnect")
}
