import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import qrcode from 'qrcode';
import EventModel from '../db/CreateEvent.js';
import TicketModel from '../db/CreateTicket.js';
import UserModel from '../db/CreateUser.js';
import ScannedModel from '../db/ScanTicket.js';
import LoginModel from '../db/UserLogin.js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
const router = express.Router();

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'Unauthorized User' });

  jwt.verify(token, 'secretkey', (err, user) => {
    if (err) return res.status(403).json({ message: 'Token not Valid' });
    req.user = user;
    next();
  });
}

async function createEvent(req, res) {
  try {
    const { title, webhookUrl } = req.body;

    if (!title) {
      return res
        .status(400)
        .json({ error: 'Title is required for creating an event' });
    }

    const event = new EventModel({ title, webhookUrl, user: req.user.userId });
    const result = await event.save();

    res
      .status(201)
      .json({ message: 'Event created successfully', event: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createTicket(req, res) {
  try {
    const { eventId, name, contactNumber, ...dynamicFields } = req.body;

    if (!eventId) {
      return res
        .status(400)
        .json({ error: 'Event ID is required to create a ticket' });
    }

    const event = await EventModel.findById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.user.toString() !== req.user.userId) {
      return res
        .status(403)
        .json({ error: 'Unauthorized: You are not the owner of this event' });
    }

    // Generate a UUID for the ticketuid
    const ticketuid = uuidv4();

    const qrCodeDataURL = await generateQRCodeDataURL(ticketuid);

    // Create a new ticket with the generated UUID
    const ticketData = {
      event: eventId,
      user: req.user.userId,
      name: name,
      contactNumber: contactNumber,
      ...dynamicFields,
      ticketuid: ticketuid,
      qrcode: qrCodeDataURL,
      qrCodeContent: ticketuid,
    };

    const ticket = new TicketModel(ticketData);

    const ticketDetails = await ticket.save();

    res
      .status(201)
      .json({ message: 'Ticket created successfully', ticket: ticketDetails });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function generateQRCodeDataURL(qrCodeContent) {
  try {
    const qrCodeDataURL = await qrcode.toDataURL(qrCodeContent);
    return qrCodeDataURL;
  } catch (error) {
    throw new Error('Error generating QR code');
  }
}

async function scanTicket(req, res) {
  try {
    const { qrCodeContent } = req.params;

    if (!qrCodeContent) {
      return res.status(400).json({ error: 'QR Code Content is required' });
    }

    const ticket = await TicketModel.findOne({ qrCodeContent }).populate(
      'event'
    );

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const existingScan = await ScannedModel.findOne({
      user: req.user.userId,
      ticket: ticket._id,
    }).populate('ticket');

    if (existingScan) {
      return res.status(400).json({
        error: 'Ticket already scanned by the current user',
        scannedDetails: existingScan,
      });
    }

    const updatedTickets = await TicketModel.findByIdAndUpdate(
      ticket._id,
      { scanned: true },
      { new: true }
    );

    // Create a new entry in the scanned model
    await ScannedModel.create({
      user: req.user.userId,
      ticket: ticket._id,
      scanned: true,
      checkInTime: new Date(),
    });

    if (!ticket.scanned && ticket.event && ticket.event.webhookUrl) {
      console.log(
        'Sending scanned details to webhook URL:',
        ticket.event.webhookUrl
      );

      const payload = {
        ticketId: ticket._id,
        checkInTime: new Date(),
        user: req.user.userId,
        ticket: updatedTickets,
      };

      await axios.post(ticket.event.webhookUrl, payload);

      console.log('Scanned details sent successfully to webhook URL');
    } else {
      console.log(
        'Ticket has already been scanned or webhook URL is not provided'
      );
    }
    // Return the updated ticket
    res
      .status(200)
      .json({ message: 'Ticket successfully scanned', ticket: updatedTickets });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createUser(req, res) {
  try {
    const { email, username, password } = req.body;

    // Check if the email already exists
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: 'Email already exists', userId: existingUser._id });
    }

    // Create a new user
    const newUser = new UserModel({ email, username, password });
    await newUser.save();

    res
      .status(201)
      .json({ message: 'User created successfully', userId: newUser._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    // Check if the user exists
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the password is correct
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if login details already exist for the user
    let loginDetails = await LoginModel.findOne({ user: user._id });

    if (!loginDetails) {
      // Generate JWT token without expiration
      const token = jwt.sign({ userId: user._id }, 'secretkey');

      // Store login details in the database
      loginDetails = new LoginModel({
        user: user._id,
        email: user.email,
        token: token,
      });
      await loginDetails.save();
    }

    // Include login details in the response
    return res
      .status(200)
      .json({ message: 'Login successful', loginDetails: loginDetails });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateTicket(req, res) {
  try {
    const { ticketId } = req.params;
    const updateFields = req.body;

    // Check if ticketId is provided
    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    // Find the ticket by its ID
    const ticket = await TicketModel.findById(ticketId);

    // Check if the ticket exists
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Update ticket details dynamically
    for (const [key, value] of Object.entries(updateFields)) {
      ticket[key] = value;
    }

    // Save the updated ticket
    const updatedTicket = await ticket.save();

    // Return the updated ticket
    res
      .status(200)
      .json({ message: 'Ticket details updated', ticket: updatedTicket });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAllTicketDetails(req, res) {
  try {
    // Fetch all tickets
    const tickets = await TicketModel.find();

    // Return all ticket details
    res.status(200).json({ tickets });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTicketDetails(req, res) {
  try {
    const { ticketId } = req.params;

    // Check if ticketId is provided
    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    // Find the ticket by its ID
    const ticket = await TicketModel.findById(ticketId);

    // Check if the ticket exists
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.status(200).json({ ticket });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Routes
router.post('/event', authenticateToken, createEvent);
router.post('/ticket', authenticateToken, createTicket);
router.post('/ticket/:qrCodeContent', authenticateToken, scanTicket);
router.get('/tickets', authenticateToken, getAllTicketDetails);
router.get('/ticket/:ticketId', authenticateToken, getTicketDetails);
router.post('/ticketUpdate/:ticketId', authenticateToken, updateTicket);
router.post('/signup', createUser);
router.post('/login', login);

export default router;