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
import saveMedia from '../helper/s3.js';
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
    const { eventId, name, waNumber, ...dynamicFields } = req.body;

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

    let qrCodeData;
    try {
      qrCodeData = await generateQRCodeDataURL(ticketuid);
    } catch (error) {
      return res
        .status(400)
        .json({ error: 'Facing some issue in QR Code generation' });
    }

    let media;
    try {
      media = await saveMedia(qrCodeData.buffer);
    } catch (error) {
      return res
        .status(400)
        .json({ error: 'Facing some issue in generating s3 image of QR Code' });
    }

    if (!media.success) {
      return res
        .status(400)
        .json({ error: 'Facing some issue in generating s3 image of QR Code' });
    }

    // Create a new ticket with the generated UUID
    const ticketData = {
      event: eventId,
      user: req.user.userId,
      name: name,
      waNumber: waNumber,
      ...dynamicFields,
      ticketuid: ticketuid,
      qrcode: qrCodeData.base64,
      qrCodeContent: ticketuid,
      qrimage: media.link,
    };

    const ticket = new TicketModel(ticketData);

    const ticketDetails = await ticket.save();

    // Send ticket details to webhook URL
    if (event.webhookUrl) {
      console.log('Sending ticket details to webhook URL:', event.webhookUrl);
      const payload = {
        ticketId: ticketDetails._id,
        ticket: ticketDetails, // Only sending ticket details
      };
      await axios.post(event.webhookUrl, payload);
      console.log('Ticket details sent successfully to webhook URL');
    } else {
      console.log('Webhook URL is not provided for the event');
    }

    return res
      .status(201)
      .json({ message: 'Ticket created successfully', ticket: ticketDetails });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function generateQRCodeDataURL(qrCodeContent) {
  try {
    const qrCodeDataURL = await qrcode.toDataURL(qrCodeContent);
    const qrCodeDataBuffer = await qrcode.toBuffer(qrCodeContent);
    return { base64: qrCodeDataURL, buffer: qrCodeDataBuffer };
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
      console.log('Ticket already scanned by the current user');
    }

    const updatedTicket = await TicketModel.findByIdAndUpdate(
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

    if (ticket.event && ticket.event.webhookUrl) {
      console.log(
        'Sending scanned details to webhook URL:',
        ticket.event.webhookUrl
      );

      const payload = {
        ticketId: ticket._id,
        checkInTime: new Date(),
        user: req.user.userId,
        ticket: updatedTicket,
      };

      await axios.post(ticket.event.webhookUrl, payload);

      console.log('Scanned details sent successfully to webhook URL');
    } else {
      console.log('Webhook URL is not provided for the event');
    }

    // Return the response to the client
    res
      .status(200)
      .json({ message: 'Ticket successfully scanned', ticket: updatedTicket });
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

// async function getAllTicketDetails(req, res) {
//   try {
//     // Fetch all tickets
//     const tickets = await TicketModel.find();

//     // Return all ticket details
//     res.status(200).json({ tickets });
//   } catch (error) {
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

async function getAllTicketDetails(req, res) {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const options = {
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
    };

    const tickets = await TicketModel.find({ eventId }, {}, options);
    const totalTickets = await TicketModel.countDocuments({ eventId });

    res.status(200).json({ tickets, totalTickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getTicketDetails(req, res) {
  try {
    const { ticketId } = req.params;

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

//verify ticket from scanner app

async function verifyTicket(req, res) {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(200).json({ success: false, error: 'Code is missing' });
    }

    const ticket = await TicketModel.findOne({ qrCodeContent: code }).populate(
      'event'
    );

    if (!ticket) {
      return res
        .status(200)
        .json({ success: false, error: 'Ticket not found' });
    }

    let scanData = await ScannedModel.findOne({
      user: ticket.user,
      ticket: ticket._id,
    }).populate('ticket');

    if (scanData) {
      return res.status(200).json({
        success: true,
        error: 'Ticket already scanned by the current user',
        ticket: scanData,
      });
    }

    const updatedTickets = await TicketModel.findByIdAndUpdate(
      ticket._id,
      { scanned: true },
      { new: true }
    );

    // Create a new entry in the scanned model
    scanData = await ScannedModel.create({
      user: ticket.user,
      ticket: ticket._id,
      scanned: true,
      checkInTime: new Date(),
    });

    if (!ticket.scanned && ticket.event && ticket.event.webhookUrl) {
      const payload = {
        ticketId: ticket._id,
        user: ticket.user,
        ticket: { ...scanData._doc, ticket: updatedTickets },
      };
      await axios.post(ticket.event.webhookUrl, payload);
    }
    // Return the updated ticket
    res.status(200).json({
      success: true,
      message: 'Ticket successfully scanned',
      ticket: { ...scanData._doc, ticket: updatedTickets },
    });
  } catch (err) {
    res.status(200).json({ success: false, error: 'Internal server error' });
  }
}
router.post('/ticket/verify', verifyTicket);

async function updateEvent(req, res) {
  try {
    const { eventId } = req.params;
    const updateFields = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    const event = await EventModel.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    for (const [key, value] of Object.entries(updateFields)) {
      event[key] = value;
    }

    const updatedEvent = await event.save();
    res
      .status(200)
      .json({ message: 'Event details updated', event: updatedEvent });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}


async function getAllEventDetails(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const events = await EventModel.find().skip(skip).limit(parseInt(limit));

    const totalEvents = await EventModel.countDocuments();

    res.status(200).json({ events, totalEvents });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// async function getAllEventDetails(req, res) {
//   try {
//     const events = await EventModel.find();
//     res.status(200).json({ events });
//   } catch (error) {
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }
// async function getAllEventDetails(req, res) {
//   try {
//     // Check if user ID is present in the request
//     if (!req.user || !req.user.userId) {
//       return res.status(400).json({ error: 'User ID is missing' });
//     }

//     // Fetch all events associated with the user ID
//     const events = await EventModel.find({ user: req.user.userId });

//     res.status(200).json({ events });
//   } catch (error) {
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

async function deleteEvent(req, res) {
  try {
    const { eventId } = req.params;
    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    const event = await EventModel.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await EventModel.findByIdAndDelete(eventId);
    res.status(200).json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteTicket(req, res) {
  try {
    const { ticketId } = req.params;
    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    const ticket = await TicketModel.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    await TicketModel.findByIdAndDelete(ticketId);
    res.status(200).json({ message: 'Ticket deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
// fetch  particular event id related all tickets

// Define the new route handler
async function getEventTickets(req, res) {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    //  8805382549 // Find all tickets related to the provided event ID
    const tickets = await TicketModel.find({ event: eventId });

    res.status(200).json({ tickets });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Add a route to fetch all tickets related to a particular event ID
router.get('/event/:eventId/tickets', authenticateToken, getEventTickets);

router.post('/event/update/:eventId', authenticateToken, updateEvent);
router.get('/events', authenticateToken, getAllEventDetails);
router.delete('/event/:eventId', authenticateToken, deleteEvent);
router.delete('/ticket/:ticketId', authenticateToken, deleteTicket);

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
